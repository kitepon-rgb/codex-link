import type { RelayService, RoutedHostMessage } from "./relay.js";
import type { CachedRelayEvent } from "./state.js";
import type {
  CodexLinkEvent,
  ConnectionId,
  DeviceId,
  HostId,
  ProjectId,
  UserId,
} from "@codex-link/protocol";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { RelayError } from "./errors.js";

export type RelayWebSocketRole = "host" | "client";

export type RelayClientMessage =
  | {
      type: "client.subscribeHost";
      hostId: HostId;
      afterSequence?: number;
    }
  | {
      type: "client.toHost";
      hostId: HostId;
      payload: unknown;
    }
  | {
      type: "host.event";
      event: CodexLinkEvent;
    };

export type RelayServerMessage =
  | {
      type: "relay.ready";
      role: RelayWebSocketRole;
      connectionId: ConnectionId;
    }
  | {
      type: "relay.error";
      code: string;
      message: string;
    }
  | {
      type: "host.message";
      message: RoutedHostMessage;
    }
  | {
      type: "host.event";
      event: CachedRelayEvent;
    };

interface HostSession {
  role: "host";
  socket: WebSocket;
  hostId: HostId;
  connectionId: ConnectionId;
}

interface ClientSession {
  role: "client";
  socket: WebSocket;
  userId: UserId;
  connectionId: ConnectionId;
  subscriptions: Set<HostId>;
}

type RelaySession = HostSession | ClientSession;

export interface RelayWebSocketGatewayOptions {
  path?: string;
}

export class RelayWebSocketGateway {
  private readonly server: WebSocketServer;
  private readonly sessions = new Map<WebSocket, RelaySession>();

  constructor(
    private readonly relay: RelayService,
    httpServer: HttpServer,
    options: RelayWebSocketGatewayOptions = {},
  ) {
    this.server = new WebSocketServer({
      server: httpServer,
      path: options.path ?? "/relay",
    });
    this.server.on("connection", (socket, request) => {
      this.handleConnection(socket, request.url ?? "").catch((error: unknown) => {
        this.sendError(socket, error);
        socket.close();
      });
    });
  }

  close(): Promise<void> {
    for (const socket of this.sessions.keys()) {
      socket.close();
    }
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async handleConnection(socket: WebSocket, requestUrl: string): Promise<void> {
    const url = new URL(requestUrl, "ws://relay.local");
    const kind = url.searchParams.get("kind");
    if (kind === "host") {
      this.acceptHost(socket, url);
      return;
    }
    if (kind === "client") {
      this.acceptClient(socket, url);
      return;
    }
    throw new RelayError("Unknown relay WebSocket kind", "BAD_WEBSOCKET_KIND");
  }

  private acceptHost(socket: WebSocket, url: URL): void {
    const deviceId = requiredParam<DeviceId>(url, "deviceId");
    const hostId = requiredParam<HostId>(url, "hostId");
    const connection = this.relay.connectDevice(deviceId, hostId);
    const host = this.relay.markHostOnline(hostId);
    const session: HostSession = {
      role: "host",
      socket,
      hostId,
      connectionId: connection.id,
    };
    this.sessions.set(socket, session);
    this.send(socket, {
      type: "relay.ready",
      role: "host",
      connectionId: connection.id,
    });
    this.broadcastHostEvent(hostId, this.relay.appendHostEvent(hostId, { type: "host.online", host }));
    socket.on("message", (raw) => {
      try {
        this.handleHostMessage(session, raw.toString());
      } catch (error) {
        this.sendError(socket, error);
      }
    });
    socket.on("close", () => {
      this.sessions.delete(socket);
      const offlineHost = this.relay.markHostOffline(hostId);
      this.broadcastHostEvent(
        hostId,
        this.relay.appendHostEvent(hostId, {
          type: "host.offline",
          hostId: offlineHost.id,
        }),
      );
    });
  }

  private acceptClient(socket: WebSocket, url: URL): void {
    const deviceId = requiredParam<DeviceId>(url, "deviceId");
    const userId = requiredParam<UserId>(url, "userId");
    const connection = this.relay.connectClientDevice(userId, deviceId);
    const session: ClientSession = {
      role: "client",
      socket,
      userId,
      connectionId: connection.id,
      subscriptions: new Set(),
    };
    this.sessions.set(socket, session);
    this.send(socket, {
      type: "relay.ready",
      role: "client",
      connectionId: connection.id,
    });
    socket.on("message", (raw) => {
      try {
        this.handleClientMessage(session, raw.toString());
      } catch (error) {
        this.sendError(socket, error);
      }
    });
    socket.on("close", () => {
      this.sessions.delete(socket);
    });
  }

  private handleClientMessage(session: ClientSession, raw: string): void {
    const message = parseClientMessage(raw);
    if (message.type === "client.subscribeHost") {
      this.relay.assertHostAccess(session.userId, message.hostId);
      session.subscriptions.add(message.hostId);
      for (const event of this.relay.readHostEvents(
        session.userId,
        message.hostId,
        message.afterSequence,
      )) {
        this.send(session.socket, { type: "host.event", event });
      }
      return;
    }
    if (message.type === "client.toHost") {
      const routed = this.relay.routeToHost(session.userId, message.hostId, message.payload);
      const hosts = this.hostSessionsFor(message.hostId);
      for (const hostSession of hosts) {
        this.send(hostSession.socket, { type: "host.message", message: routed });
      }
    }
  }

  private handleHostMessage(session: HostSession, raw: string): void {
    const message = parseClientMessage(raw);
    if (message.type !== "host.event") {
      throw new RelayError("Host connection only accepts host.event", "BAD_HOST_MESSAGE");
    }
    const cached = this.relay.appendHostEvent(session.hostId, message.event);
    this.broadcastHostEvent(session.hostId, cached);
  }

  private broadcastHostEvent(hostId: HostId, event: CachedRelayEvent): void {
    for (const session of this.sessions.values()) {
      if (session.role !== "client" || !session.subscriptions.has(hostId)) {
        continue;
      }
      try {
        this.relay.assertHostAccess(session.userId, hostId);
        this.send(session.socket, { type: "host.event", event });
      } catch {
        session.subscriptions.delete(hostId);
      }
    }
  }

  private hostSessionsFor(hostId: HostId): HostSession[] {
    return [...this.sessions.values()].filter(
      (session): session is HostSession => session.role === "host" && session.hostId === hostId,
    );
  }

  private send(socket: WebSocket, message: RelayServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(message));
  }

  private sendError(socket: WebSocket, error: unknown): void {
    const normalized = normalizeError(error);
    this.send(socket, {
      type: "relay.error",
      code: normalized.code,
      message: normalized.message,
    });
  }
}

export interface RelayHttpServer {
  httpServer: HttpServer;
  gateway: RelayWebSocketGateway;
}

export function createRelayHttpServer(relay: RelayService): RelayHttpServer {
  const httpServer = createServer((request, response) => {
    handleHttpRequest(relay, request, response).catch((error: unknown) => {
      writeJson(response, statusForError(error), normalizeError(error));
    });
  });
  const gateway = new RelayWebSocketGateway(relay, httpServer);
  return { httpServer, gateway };
}

interface HostBootstrapRequest {
  ownerDisplayName?: unknown;
  hostName?: unknown;
  project?: {
    id?: unknown;
    name?: unknown;
    path?: unknown;
  };
}

async function handleHttpRequest(
  relay: RelayService,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === "POST" && request.url === "/api/host-bootstrap") {
    const body = (await readJson(request)) as HostBootstrapRequest;
    const ownerDisplayName = requiredString(body.ownerDisplayName, "ownerDisplayName");
    const hostName = requiredString(body.hostName, "hostName");
    const project = objectValue(body.project);
    const registration = relay.registerHostBootstrap({
      token: bearerToken(request.headers.authorization),
      ownerDisplayName,
      hostName,
    });
    writeJson(response, 201, {
      relayUrl: relay.getPublicBaseUrl(),
      userId: registration.user.id,
      deviceId: registration.device.id,
      hostId: registration.host.id,
      hostName: registration.host.name,
      project: project
        ? {
            id: (stringValue(project.id) ?? "project-default") as ProjectId,
            name: stringValue(project.name) ?? "Project",
            path: stringValue(project.path) ?? "",
          }
        : null,
    });
    return;
  }
  writeJson(response, 404, { code: "NOT_FOUND", message: "Not found" });
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch {
        reject(new RelayError("Invalid JSON body", "BAD_JSON"));
      }
    });
  });
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function statusForError(error: unknown): number {
  const normalized = normalizeError(error);
  if (normalized.code === "HOST_ACCESS_DENIED" || normalized.code === "AUTHENTICATION_REQUIRED") {
    return 401;
  }
  if (normalized.code === "NOT_FOUND") {
    return 404;
  }
  if (normalized.code === "BAD_JSON" || normalized.code === "MISSING_PARAMETER") {
    return 400;
  }
  return 500;
}

function bearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length);
}

function requiredString(value: unknown, name: string): string {
  const parsed = stringValue(value);
  if (!parsed) {
    throw new RelayError(`Missing request field: ${name}`, "MISSING_PARAMETER");
  }
  return parsed;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredParam<T extends string>(url: URL, name: string): T {
  const value = url.searchParams.get(name);
  if (!value) {
    throw new RelayError(`Missing WebSocket parameter: ${name}`, "MISSING_PARAMETER");
  }
  return value as T;
}

function parseClientMessage(raw: string): RelayClientMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
    throw new RelayError("Invalid relay message", "BAD_MESSAGE");
  }
  return parsed as RelayClientMessage;
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof RelayError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: error.message };
  }
  return { code: "INTERNAL_ERROR", message: String(error) };
}
