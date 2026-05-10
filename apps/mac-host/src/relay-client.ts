import type { CodexLinkEvent, Host, ProjectRef } from "@codex-link/protocol";
import WebSocket from "ws";
import type { MacHostConfig } from "./config.js";
import { readMacHostCapabilities } from "./capabilities.js";

export interface MacHostRelayClientOptions {
  config: MacHostConfig;
  WebSocketImpl?: typeof WebSocket;
  onHostMessage?: (payload: unknown) => void;
}

export interface MacHostPairingCode {
  hostId: string;
  code: string;
  expiresAt: string;
}

export class MacHostRelayClient {
  private socket: WebSocket | null = null;
  private readonly WebSocketImpl: typeof WebSocket;
  private pairingCodeRequest: {
    resolve: (pairingCode: MacHostPairingCode) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(private readonly options: MacHostRelayClientOptions) {
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  }

  connect(): Promise<void> {
    const socket = new this.WebSocketImpl(this.buildRelayUrl(), {
      headers: {
        authorization: `Bearer ${this.options.config.deviceToken}`,
      },
    });
    this.socket = socket;
    return new Promise((resolve, reject) => {
      socket.once("open", () => {
        socket.on("message", (raw) => this.handleRelayMessage(raw.toString()));
        socket.on("error", (error) => {
          this.rejectPairingCodeRequest(error);
        });
        socket.on("close", () => {
          this.rejectPairingCodeRequest(new Error("Relay WebSocket closed"));
        });
        resolve();
      });
      socket.once("error", reject);
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  async announce(): Promise<void> {
    const host: Host = {
      id: this.options.config.hostId,
      ownerUserId: this.options.config.userId,
      deviceId: this.options.config.deviceId,
      name: this.options.config.hostName,
      platform: "macos",
      status: "online",
    };
    this.sendHostEvent({ type: "host.online", host });
    this.sendHostEvent({
      type: "project.list.updated",
      hostId: this.options.config.hostId,
      projects: this.projectRefs(),
    });
    const capabilities = await readMacHostCapabilities(this.options.config);
    this.sendHostEvent({
      type: "host.capabilities.updated",
      hostId: this.options.config.hostId,
      capabilities,
    });
  }

  sendHostEvent(event: CodexLinkEvent): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Relay WebSocket is not open");
    }
    this.socket.send(JSON.stringify({ type: "host.event", event }));
  }

  createPairingCode(): Promise<MacHostPairingCode> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Relay WebSocket is not open");
    }
    if (this.pairingCodeRequest) {
      throw new Error("Host pairing code request is already in flight");
    }
    this.socket.send(JSON.stringify({ type: "host.pairingCode.create" }));
    return new Promise((resolve, reject) => {
      this.pairingCodeRequest = { resolve, reject };
    });
  }

  buildRelayUrl(): string {
    const url = new URL(this.options.config.relayUrl);
    url.pathname = joinPath(url.pathname, "relay");
    url.searchParams.set("kind", "host");
    url.searchParams.set("deviceId", this.options.config.deviceId);
    url.searchParams.set("hostId", this.options.config.hostId);
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol === "https:") {
      url.protocol = "wss:";
    }
    return url.toString();
  }

  private projectRefs(): ProjectRef[] {
    return this.options.config.projects.map((project) => ({
      id: project.id,
      hostId: this.options.config.hostId,
      name: project.name,
      pathLabel: project.path,
    }));
  }

  private handleRelayMessage(raw: string): void {
    const message = JSON.parse(raw) as unknown;
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "host.pairingCode.created"
    ) {
      const pairingCode = pairingCodeMessage(message);
      if (pairingCode) {
        this.resolvePairingCodeRequest(pairingCode);
      }
      return;
    }
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "relay.error" &&
      "code" in message &&
      "message" in message &&
      typeof message.code === "string" &&
      typeof message.message === "string"
    ) {
      this.rejectPairingCodeRequest(
        new Error(`Relay error ${message.code}: ${message.message}`),
      );
      return;
    }
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "host.message" &&
      "message" in message
    ) {
      const routed = message.message as { payload?: unknown };
      this.options.onHostMessage?.(routed.payload);
    }
  }

  private resolvePairingCodeRequest(pairingCode: MacHostPairingCode): void {
    const request = this.pairingCodeRequest;
    this.pairingCodeRequest = null;
    request?.resolve(pairingCode);
  }

  private rejectPairingCodeRequest(error: Error): void {
    const request = this.pairingCodeRequest;
    this.pairingCodeRequest = null;
    request?.reject(error);
  }
}

function pairingCodeMessage(message: object): MacHostPairingCode | null {
  if (!("hostId" in message) || !("code" in message) || !("expiresAt" in message)) {
    return null;
  }
  if (
    typeof message.hostId !== "string" ||
    typeof message.code !== "string" ||
    typeof message.expiresAt !== "string"
  ) {
    return null;
  }
  return {
    hostId: message.hostId,
    code: message.code,
    expiresAt: message.expiresAt,
  };
}

function joinPath(basePath: string, child: string): string {
  const normalized = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  if (!normalized) {
    return `/${child}`;
  }
  return `${normalized}/${child}`;
}
