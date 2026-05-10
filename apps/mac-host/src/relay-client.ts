import type { CodexLinkEvent, Host, ProjectRef } from "@codex-link/protocol";
import WebSocket from "ws";
import type { MacHostConfig } from "./config.js";
import { readMacHostCapabilities } from "./capabilities.js";

export interface MacHostRelayClientOptions {
  config: MacHostConfig;
  WebSocketImpl?: typeof WebSocket;
  onHostMessage?: (payload: unknown) => void;
}

export class MacHostRelayClient {
  private socket: WebSocket | null = null;
  private readonly WebSocketImpl: typeof WebSocket;

  constructor(private readonly options: MacHostRelayClientOptions) {
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  }

  connect(): Promise<void> {
    const socket = new this.WebSocketImpl(this.buildRelayUrl());
    this.socket = socket;
    return new Promise((resolve, reject) => {
      socket.once("open", () => {
        socket.on("message", (raw) => this.handleRelayMessage(raw.toString()));
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
      message.type === "host.message" &&
      "message" in message
    ) {
      const routed = message.message as { payload?: unknown };
      this.options.onHostMessage?.(routed.payload);
    }
  }
}

function joinPath(basePath: string, child: string): string {
  const normalized = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  if (!normalized) {
    return `/${child}`;
  }
  return `${normalized}/${child}`;
}
