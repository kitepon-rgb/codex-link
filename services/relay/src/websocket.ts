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
    }
  | {
      type: "host.pairingCode.create";
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
    }
  | {
      type: "host.subscription.ready";
      hostId: HostId;
      afterSequence: number;
      latestSequence: number;
    }
  | {
      type: "host.pairingCode.created";
      hostId: HostId;
      code: string;
      expiresAt: string;
    };

interface HostSession {
  role: "host";
  socket: WebSocket;
  deviceId: DeviceId;
  hostId: HostId;
  connectionId: ConnectionId;
}

interface ClientSession {
  role: "client";
  socket: WebSocket;
  deviceId: DeviceId;
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
      maxPayload: relay.getMaxWebSocketPayloadBytes(),
    });
    this.server.on("connection", (socket, request) => {
      socket.on("error", () => {
        this.sessions.delete(socket);
      });
      this.handleConnection(socket, request).catch((error: unknown) => {
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

  disconnectDeviceSessions(deviceId: DeviceId): void {
    for (const [socket, session] of this.sessions) {
      if (session.deviceId !== deviceId) {
        continue;
      }
      this.send(socket, {
        type: "relay.error",
        code: "HOST_ACCESS_DENIED",
        message: "Revoked device cannot connect",
      });
      socket.close();
    }
  }

  disconnectHostAccessSessions(userId: UserId, hostId: HostId): void {
    for (const session of this.sessions.values()) {
      if (
        session.role !== "client" ||
        session.userId !== userId ||
        !session.subscriptions.has(hostId)
      ) {
        continue;
      }
      session.subscriptions.delete(hostId);
      this.send(session.socket, {
        type: "relay.error",
        code: "HOST_ACCESS_DENIED",
        message: "HostAccess was revoked",
      });
    }
  }

  private async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    const requestUrl = request.url ?? "";
    const url = new URL(requestUrl, "ws://relay.local");
    const kind = url.searchParams.get("kind");
    if (kind === "host") {
      this.acceptHost(socket, url, request);
      return;
    }
    if (kind === "client") {
      this.acceptClient(socket, url, request);
      return;
    }
    throw new RelayError("Unknown relay WebSocket kind", "BAD_WEBSOCKET_KIND");
  }

  private acceptHost(socket: WebSocket, url: URL, request: IncomingMessage): void {
    const deviceId = requiredParam<DeviceId>(url, "deviceId");
    const hostId = requiredParam<HostId>(url, "hostId");
    this.relay.authenticateDevice(deviceId, bearerToken(request.headers.authorization));
    const connection = this.relay.connectDevice(deviceId, hostId);
    const host = this.relay.markHostOnline(hostId);
    const session: HostSession = {
      role: "host",
      socket,
      deviceId,
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

  private acceptClient(socket: WebSocket, url: URL, request: IncomingMessage): void {
    const deviceId = requiredParam<DeviceId>(url, "deviceId");
    const userId = requiredParam<UserId>(url, "userId");
    this.relay.authenticateUserDevice(userId, deviceId, bearerToken(request.headers.authorization));
    const connection = this.relay.connectClientDevice(userId, deviceId);
    const session: ClientSession = {
      role: "client",
      socket,
      deviceId,
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
    this.relay.assertActiveDevice(session.deviceId);
    const message = parseClientMessage(raw);
    if (message.type === "client.subscribeHost") {
      this.relay.checkRateLimit({
        scope: "ws.client.subscribe_host",
        key: `${session.userId}:${message.hostId}`,
      });
      this.relay.assertHostAccess(session.userId, message.hostId);
      const afterSequence = message.afterSequence ?? 0;
      const replay = this.relay.readHostEventReplay(
        session.userId,
        message.hostId,
        afterSequence,
      );
      session.subscriptions.add(message.hostId);
      for (const event of replay.events) {
        this.send(session.socket, { type: "host.event", event });
      }
      this.send(session.socket, {
        type: "host.subscription.ready",
        hostId: message.hostId,
        afterSequence,
        latestSequence: replay.latestSequence,
      });
      return;
    }
    if (message.type === "client.toHost") {
      this.relay.checkRateLimit({
        scope: "ws.client.to_host",
        key: `${session.userId}:${message.hostId}`,
      });
      const routed = this.relay.routeToHost(session.userId, message.hostId, message.payload);
      const hosts = this.hostSessionsFor(message.hostId);
      for (const hostSession of hosts) {
        this.send(hostSession.socket, { type: "host.message", message: routed });
      }
    }
  }

  private handleHostMessage(session: HostSession, raw: string): void {
    this.relay.assertActiveDevice(session.deviceId);
    const message = parseClientMessage(raw);
    if (message.type === "host.event") {
      const cached = this.relay.appendHostEvent(session.hostId, message.event);
      this.broadcastHostEvent(session.hostId, cached);
      return;
    }
    if (message.type === "host.pairingCode.create") {
      this.relay.checkRateLimit({
        scope: "ws.host.pairing_code.create",
        key: session.hostId,
      });
      const pairingCode = this.relay.createHostPairingCode(session.hostId);
      this.send(session.socket, {
        type: "host.pairingCode.created",
        hostId: session.hostId,
        code: pairingCode.code,
        expiresAt: pairingCode.expiresAt,
      });
      return;
    }
    throw new RelayError("Host connection only accepts host.event or host.pairingCode.create", "BAD_HOST_MESSAGE");
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
  let gateway: RelayWebSocketGateway | null = null;
  const httpServer = createServer((request, response) => {
    handleHttpRequest(relay, gateway, request, response).catch((error: unknown) => {
      writeJson(response, statusForError(error), normalizeError(error));
    });
  });
  gateway = new RelayWebSocketGateway(relay, httpServer);
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

interface DeviceSessionRequest {
  displayName?: unknown;
  deviceName?: unknown;
}

interface DeviceSessionPairRequest {
  userId?: unknown;
  deviceId?: unknown;
  pairingCode?: unknown;
}

interface DeviceSessionRevokeRequest {
  userId?: unknown;
  deviceId?: unknown;
}

interface DeviceCredentialRotateRequest {
  userId?: unknown;
  deviceId?: unknown;
}

interface HostAccessGrantRequest {
  ownerUserId?: unknown;
  ownerDeviceId?: unknown;
  hostId?: unknown;
  targetUserId?: unknown;
  role?: unknown;
}

interface HostAccessRevokeRequest {
  ownerUserId?: unknown;
  ownerDeviceId?: unknown;
  hostId?: unknown;
  targetUserId?: unknown;
}

async function handleHttpRequest(
  relay: RelayService,
  gateway: RelayWebSocketGateway | null,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === "GET" && request.url === "/healthz") {
    writeJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "POST" && request.url === "/api/device-session") {
    relay.checkRateLimit({
      scope: "http.device_session.create",
      key: requestRateLimitKey(request),
    });
    const body = (await readJson(request, relay.getMaxHttpBodyBytes())) as DeviceSessionRequest;
    const displayName = requiredString(body.displayName, "displayName");
    const deviceName = requiredString(body.deviceName, "deviceName");
    const session = relay.registerPlaceholderIphoneSession(displayName, deviceName);
    writeJson(response, 201, {
      relayUrl: relay.getPublicBaseUrl(),
      userId: session.user.id,
      deviceId: session.device.id,
      deviceToken: session.deviceToken,
      deviceTokenExpiresAt: session.expiresAt,
      displayName: session.user.displayName,
      deviceName: session.device.name,
    });
    return;
  }

  if (request.method === "POST" && request.url === "/api/device-session/pair") {
    const body = (await readJson(request, relay.getMaxHttpBodyBytes())) as DeviceSessionPairRequest;
    const userId = requiredString(body.userId, "userId") as UserId;
    const deviceId = requiredString(body.deviceId, "deviceId") as DeviceId;
    const pairingCode = requiredString(body.pairingCode, "pairingCode");
    relay.authenticateUserDevice(userId, deviceId, bearerToken(request.headers.authorization));
    relay.checkRateLimit({
      scope: "http.device_session.pair",
      key: deviceId,
    });
    const grant = relay.redeemHostPairingCode({ userId, deviceId, pairingCode });
    writeJson(response, 201, {
      relayUrl: relay.getPublicBaseUrl(),
      userId: grant.user.id,
      deviceId: grant.device.id,
      hostId: grant.host.id,
      hostName: grant.host.name,
      role: grant.access.role,
    });
    return;
  }

  if (request.method === "POST" && request.url === "/api/device-session/revoke") {
    const body = (await readJson(request, relay.getMaxHttpBodyBytes())) as DeviceSessionRevokeRequest;
    const userId = requiredString(body.userId, "userId") as UserId;
    const deviceId = requiredString(body.deviceId, "deviceId") as DeviceId;
    relay.authenticateUserDevice(userId, deviceId, bearerToken(request.headers.authorization));
    relay.checkRateLimit({
      scope: "http.device_session.revoke",
      key: deviceId,
    });
    const revocation = relay.revokeDevice({ userId, deviceId });
    gateway?.disconnectDeviceSessions(deviceId);
    writeJson(response, 200, {
      relayUrl: relay.getPublicBaseUrl(),
      userId: revocation.user.id,
      deviceId: revocation.device.id,
      revokedAt: revocation.device.revokedAt,
    });
    return;
  }

  if (request.method === "POST" && request.url === "/api/device-credential/rotate") {
    const body = (await readJson(request, relay.getMaxHttpBodyBytes())) as DeviceCredentialRotateRequest;
    const userId = requiredString(body.userId, "userId") as UserId;
    const deviceId = requiredString(body.deviceId, "deviceId") as DeviceId;
    relay.authenticateUserDevice(userId, deviceId, bearerToken(request.headers.authorization));
    relay.checkRateLimit({
      scope: "http.device_credential.rotate",
      key: deviceId,
    });
    const credential = relay.rotateDeviceCredential({ userId, deviceId });
    writeJson(response, 200, {
      relayUrl: relay.getPublicBaseUrl(),
      userId: credential.user.id,
      deviceId: credential.device.id,
      deviceToken: credential.token,
      deviceTokenExpiresAt: credential.expiresAt,
    });
    return;
  }

  if (request.method === "POST" && request.url === "/api/host-access/grant") {
    const body = (await readJson(request, relay.getMaxHttpBodyBytes())) as HostAccessGrantRequest;
    const ownerUserId = requiredString(body.ownerUserId, "ownerUserId") as UserId;
    const ownerDeviceId = requiredString(body.ownerDeviceId, "ownerDeviceId") as DeviceId;
    const hostId = requiredString(body.hostId, "hostId") as HostId;
    const targetUserId = requiredString(body.targetUserId, "targetUserId") as UserId;
    const role = requiredShareableHostRole(body.role);
    relay.authenticateUserDevice(ownerUserId, ownerDeviceId, bearerToken(request.headers.authorization));
    relay.checkRateLimit({
      scope: "http.host_access.grant",
      key: `${ownerUserId}:${hostId}`,
    });
    const grant = relay.grantHostAccessByOwner({
      ownerUserId,
      hostId,
      targetUserId,
      role,
    });
    writeJson(response, 201, {
      relayUrl: relay.getPublicBaseUrl(),
      hostId: grant.host.id,
      userId: grant.targetUser.id,
      role: grant.access.role,
    });
    return;
  }

  if (request.method === "POST" && request.url === "/api/host-access/revoke") {
    const body = (await readJson(request, relay.getMaxHttpBodyBytes())) as HostAccessRevokeRequest;
    const ownerUserId = requiredString(body.ownerUserId, "ownerUserId") as UserId;
    const ownerDeviceId = requiredString(body.ownerDeviceId, "ownerDeviceId") as DeviceId;
    const hostId = requiredString(body.hostId, "hostId") as HostId;
    const targetUserId = requiredString(body.targetUserId, "targetUserId") as UserId;
    relay.authenticateUserDevice(ownerUserId, ownerDeviceId, bearerToken(request.headers.authorization));
    relay.checkRateLimit({
      scope: "http.host_access.revoke",
      key: `${ownerUserId}:${hostId}`,
    });
    const revocation = relay.revokeHostAccessByOwner({
      ownerUserId,
      hostId,
      targetUserId,
    });
    gateway?.disconnectHostAccessSessions(targetUserId, hostId);
    writeJson(response, 200, {
      relayUrl: relay.getPublicBaseUrl(),
      hostId: revocation.host.id,
      userId: revocation.targetUser.id,
      revokedRole: revocation.revokedAccess.role,
    });
    return;
  }

  if (request.method === "POST" && request.url === "/api/host-bootstrap") {
    relay.checkRateLimit({
      scope: "http.host_bootstrap",
      key: requestRateLimitKey(request),
    });
    const body = (await readJson(request, relay.getMaxHttpBodyBytes())) as HostBootstrapRequest;
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
      deviceToken: registration.deviceToken,
      deviceTokenExpiresAt: registration.expiresAt,
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

function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let tooLarge = false;
    request.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maxBodyBytes) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      if (tooLarge) {
        reject(new RelayError("HTTP request body too large", "PAYLOAD_TOO_LARGE"));
        return;
      }
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
  if (normalized.code === "RATE_LIMITED") {
    return 429;
  }
  if (normalized.code === "PAYLOAD_TOO_LARGE") {
    return 413;
  }
  if (
    normalized.code === "BAD_JSON" ||
    normalized.code === "BAD_HOST_ACCESS_ROLE" ||
    normalized.code === "MISSING_PARAMETER"
  ) {
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

function requestRateLimitKey(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? "unknown";
}

function requiredString(value: unknown, name: string): string {
  const parsed = stringValue(value);
  if (!parsed) {
    throw new RelayError(`Missing request field: ${name}`, "MISSING_PARAMETER");
  }
  return parsed;
}

function requiredShareableHostRole(value: unknown): "operator" | "viewer" {
  const role = requiredString(value, "role");
  if (role === "operator" || role === "viewer") {
    return role;
  }
  throw new RelayError("HostAccess role must be operator or viewer", "BAD_HOST_ACCESS_ROLE");
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
