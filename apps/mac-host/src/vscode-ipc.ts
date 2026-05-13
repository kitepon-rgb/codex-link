import { randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

export interface VscodeIpcMessage {
  type: string;
  method?: string;
  params?: unknown;
  requestId?: string;
  resultType?: string;
  result?: unknown;
  error?: string;
}

export interface VscodeIpcRequestOptions {
  version: number;
  timeoutMs?: number;
  allowInitializing?: boolean;
}

export interface VscodeIpcResponse {
  resultType: string;
  result?: Record<string, unknown> | undefined;
  error?: string | undefined;
}

export function defaultVscodeIpcSocketPath(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const name = uid !== null ? `ipc-${uid}.sock` : "ipc.sock";
  return path.join(os.tmpdir(), "codex-ipc", name);
}

export function vscodeIpcSocketAvailable(socketPath = defaultVscodeIpcSocketPath()): boolean {
  return existsSync(socketPath);
}

type PendingEntry = {
  resolve: (response: VscodeIpcResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type MessageListener = (message: VscodeIpcMessage) => void;

export class VscodeIpcClient {
  static async connect(options: {
    clientType: string;
    socketPath?: string;
    onMessage?: MessageListener;
    onClose?: () => void;
  }): Promise<VscodeIpcClient> {
    const client = new VscodeIpcClient(options.socketPath ?? defaultVscodeIpcSocketPath());
    if (options.onMessage) {
      client.listeners.add(options.onMessage);
    }
    if (options.onClose) {
      client.closeListeners.add(options.onClose);
    }
    await client.open(options.clientType);
    return client;
  }

  private socket: net.Socket | null = null;
  private clientId = "initializing-client";
  private buffer: Buffer = Buffer.alloc(0);
  private frameLength: number | null = null;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly listeners = new Set<MessageListener>();
  private readonly closeListeners = new Set<() => void>();
  private closed = false;

  constructor(private readonly socketPath: string) {}

  get isOpen(): boolean {
    return !this.closed && this.socket !== null;
  }

  async open(clientType: string): Promise<void> {
    const socket = net.connect(this.socketPath);
    this.socket = socket;
    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("error", (error) => {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
    });
    socket.on("close", () => {
      this.closed = true;
      this.rejectAll(new Error("vscode_ipc_connection_closed"));
      for (const listener of this.closeListeners) {
        try {
          listener();
        } catch (error) {
          console.error(`[mac-host] vscode-ipc close listener error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
    await waitConnected(socket);
    const response = await this.request(
      "initialize",
      { clientType },
      { version: 0, allowInitializing: true, timeoutMs: 5000 },
    );
    if (response.resultType !== "success") {
      throw new Error(response.error ?? "vscode_ipc_initialize_failed");
    }
    const cid = (response.result as { clientId?: string } | undefined)?.clientId;
    if (!cid) {
      throw new Error("vscode_ipc_initialize_missing_clientId");
    }
    this.clientId = cid;
  }

  request(
    method: string,
    params: unknown,
    options: VscodeIpcRequestOptions,
  ): Promise<VscodeIpcResponse> {
    const { version, allowInitializing = false, timeoutMs = 15000 } = options;
    if (!allowInitializing && this.clientId === "initializing-client") {
      return Promise.reject(new Error("vscode_ipc_not_initialized"));
    }
    if (!this.socket || this.closed) {
      return Promise.reject(new Error("vscode_ipc_socket_closed"));
    }
    const requestId = randomUUID();
    const payload = {
      type: "request",
      requestId,
      sourceClientId: this.clientId,
      version,
      method,
      params,
    };
    return new Promise<VscodeIpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("vscode_ipc_request_timeout"));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(requestId, { resolve, reject, timer });
      this.write(payload);
    });
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    this.closed = true;
    this.socket?.end();
  }

  private handleData(chunk: Buffer | string): void {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    this.buffer = Buffer.concat([this.buffer, buf]);
    for (;;) {
      if (this.frameLength == null) {
        if (this.buffer.length < 4) {
          return;
        }
        this.frameLength = this.buffer.readUInt32LE(0);
        this.buffer = this.buffer.subarray(4);
      }
      if (this.buffer.length < this.frameLength) {
        return;
      }
      let payload: VscodeIpcMessage;
      try {
        payload = JSON.parse(this.buffer.subarray(0, this.frameLength).toString("utf8")) as VscodeIpcMessage;
      } catch (error) {
        this.buffer = this.buffer.subarray(this.frameLength);
        this.frameLength = null;
        continue;
      }
      this.buffer = this.buffer.subarray(this.frameLength);
      this.frameLength = null;
      if (payload.type === "response" && payload.requestId) {
        const pending = this.pending.get(payload.requestId);
        if (pending) {
          this.pending.delete(payload.requestId);
          clearTimeout(pending.timer);
          pending.resolve({
            resultType: payload.resultType ?? "unknown",
            result: payload.result as Record<string, unknown> | undefined,
            error: payload.error,
          });
        }
      }
      for (const listener of this.listeners) {
        try {
          listener(payload);
        } catch (error) {
          console.error(`[mac-host] vscode-ipc listener error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  private write(payload: unknown): void {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    this.socket?.write(Buffer.concat([header, body]));
  }

  private rejectAll(error: Error): void {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

function waitConnected(socket: net.Socket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
  });
}
