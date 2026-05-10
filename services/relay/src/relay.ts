import type {
  CodexLinkEvent,
  Connection,
  Device,
  DeviceId,
  Host,
  HostAccess,
  HostId,
  User,
  UserId,
} from "@codex-link/protocol";
import { randomBytes } from "node:crypto";
import { RelayAuthzError, RelayError, RelayNotFoundError } from "./errors.js";
import { createId } from "./id.js";
import type { RelayConfig } from "./config.js";
import { loadRelayConfig } from "./config.js";
import type { CachedRelayEvent, HostPairingCode, RelayState } from "./state.js";
import { createRelayState } from "./state.js";

const DEFAULT_PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export interface RoutedHostMessage {
  hostId: HostId;
  userId: UserId;
  payload: unknown;
}

export interface HostBootstrapInput {
  token: string | null;
  ownerDisplayName: string;
  hostName: string;
}

export interface HostBootstrapRegistration {
  user: User;
  device: Device;
  host: Host;
}

export interface PlaceholderDeviceSession {
  user: User;
  device: Device;
}

export interface HostPairingGrant {
  user: User;
  device: Device;
  host: Host;
  access: HostAccess;
}

export interface HostEventReplay {
  events: CachedRelayEvent[];
  latestSequence: number;
}

export class RelayService {
  constructor(
    private readonly state: RelayState = createRelayState(),
    private readonly config: RelayConfig = loadRelayConfig(),
  ) {}

  loginPlaceholder(displayName: string): User {
    const user: User = {
      id: createId<"UserId">("usr"),
      displayName,
    };
    this.state.users.set(user.id, user);
    return user;
  }

  registerDevice(userId: UserId, name: string, kind: Device["kind"]): Device {
    this.requireUser(userId);
    const device: Device = {
      id: createId<"DeviceId">("dev"),
      userId,
      name,
      kind,
      revokedAt: null,
    };
    this.state.devices.set(device.id, device);
    return device;
  }

  registerHost(ownerUserId: UserId, deviceId: DeviceId, name: string): Host {
    const device = this.requireDevice(deviceId);
    if (device.userId !== ownerUserId || device.kind !== "mac-host") {
      throw new RelayAuthzError("Only the owner mac-host device can register a Host");
    }
    const host: Host = {
      id: createId<"HostId">("host"),
      ownerUserId,
      deviceId,
      name,
      platform: "macos",
      status: "offline",
    };
    this.state.hosts.set(host.id, host);
    this.state.hostAccess.push({
      hostId: host.id,
      userId: ownerUserId,
      role: "owner",
    });
    return host;
  }

  registerHostBootstrap(input: HostBootstrapInput): HostBootstrapRegistration {
    if (!this.config.hostBootstrapToken) {
      throw new RelayAuthzError("Host bootstrap token is not configured");
    }
    if (!input.token || input.token !== this.config.hostBootstrapToken) {
      throw new RelayAuthzError("Invalid Host bootstrap token");
    }
    const user = this.loginPlaceholder(input.ownerDisplayName);
    const device = this.registerDevice(user.id, input.hostName, "mac-host");
    const host = this.registerHost(user.id, device.id, input.hostName);
    return { user, device, host };
  }

  registerPlaceholderIphoneSession(displayName: string, deviceName: string): PlaceholderDeviceSession {
    const user = this.loginPlaceholder(displayName);
    const device = this.registerDevice(user.id, deviceName, "iphone");
    return { user, device };
  }

  createHostPairingCode(
    hostId: HostId,
    options: { now?: Date; ttlMs?: number } = {},
  ): HostPairingCode {
    this.requireHost(hostId);
    const now = options.now ?? new Date();
    const ttlMs = options.ttlMs ?? DEFAULT_PAIRING_CODE_TTL_MS;
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    let code = formatPairingCode(randomBytes(4).toString("hex"));
    while (this.state.hostPairingCodes.has(normalizePairingCode(code))) {
      code = formatPairingCode(randomBytes(4).toString("hex"));
    }
    const pairingCode: HostPairingCode = {
      code,
      hostId,
      createdAt: now.toISOString(),
      expiresAt,
      consumedAt: null,
    };
    this.state.hostPairingCodes.set(normalizePairingCode(code), pairingCode);
    return pairingCode;
  }

  redeemHostPairingCode(input: {
    userId: UserId;
    deviceId: DeviceId;
    pairingCode: string;
    now?: Date;
  }): HostPairingGrant {
    const user = this.requireUser(input.userId);
    const device = this.requireDevice(input.deviceId);
    if (device.revokedAt) {
      throw new RelayAuthzError("Revoked device cannot pair");
    }
    if (device.userId !== user.id || device.kind !== "iphone") {
      throw new RelayAuthzError("Pairing requires the user's iPhone device");
    }
    const pairingCode = this.requirePairingCode(input.pairingCode);
    if (pairingCode.consumedAt) {
      throw new RelayAuthzError("Host pairing code has already been used");
    }
    const now = input.now ?? new Date();
    if (Date.parse(pairingCode.expiresAt) <= now.getTime()) {
      throw new RelayAuthzError("Host pairing code has expired");
    }

    pairingCode.consumedAt = now.toISOString();
    const host = this.requireHost(pairingCode.hostId);
    const access = this.grantHostAccess(host.id, user.id, "operator");
    return { user, device, host, access };
  }

  grantHostAccess(hostId: HostId, userId: UserId, role: HostAccess["role"]): HostAccess {
    this.requireHost(hostId);
    this.requireUser(userId);
    const existing = this.state.hostAccess.find(
      (access) => access.hostId === hostId && access.userId === userId,
    );
    if (existing) {
      existing.role = role;
      return existing;
    }
    const access: HostAccess = { hostId, userId, role };
    this.state.hostAccess.push(access);
    return access;
  }

  listHostsForUser(userId: UserId): Host[] {
    this.requireUser(userId);
    const allowedHostIds = new Set(
      this.state.hostAccess
        .filter((access) => access.userId === userId)
        .map((access) => access.hostId),
    );
    return [...this.state.hosts.values()].filter((host) => allowedHostIds.has(host.id));
  }

  connectDevice(deviceId: DeviceId, hostId?: HostId): Connection {
    const device = this.requireDevice(deviceId);
    if (device.revokedAt) {
      throw new RelayAuthzError("Revoked device cannot connect");
    }
    if (hostId) {
      const host = this.requireHost(hostId);
      if (host.deviceId !== deviceId) {
        throw new RelayAuthzError("Host connection must use the registered Host device");
      }
    }
    const connection: Connection = {
      id: createId<"ConnectionId">("conn"),
      deviceId,
      connectedAt: new Date().toISOString(),
    };
    if (hostId) {
      connection.hostId = hostId;
    }
    this.state.connections.set(connection.id, connection);
    return connection;
  }

  connectClientDevice(userId: UserId, deviceId: DeviceId): Connection {
    this.requireUser(userId);
    const device = this.requireDevice(deviceId);
    if (device.revokedAt) {
      throw new RelayAuthzError("Revoked device cannot connect");
    }
    if (device.userId !== userId || device.kind !== "iphone") {
      throw new RelayAuthzError("Client connection must use the user's iPhone device");
    }
    const connection: Connection = {
      id: createId<"ConnectionId">("conn"),
      deviceId,
      connectedAt: new Date().toISOString(),
    };
    this.state.connections.set(connection.id, connection);
    return connection;
  }

  markHostOnline(hostId: HostId): Host {
    const host = this.requireHost(hostId);
    host.status = "online";
    return host;
  }

  markHostOffline(hostId: HostId): Host {
    const host = this.requireHost(hostId);
    host.status = "offline";
    return host;
  }

  routeToHost(userId: UserId, hostId: HostId, payload: unknown): RoutedHostMessage {
    this.assertHostAccess(userId, hostId);
    return { userId, hostId, payload };
  }

  appendHostEvent(hostId: HostId, event: CodexLinkEvent): CachedRelayEvent {
    this.requireHost(hostId);
    const cached: CachedRelayEvent = {
      sequence: this.state.nextEventSequence++,
      hostId,
      event,
      receivedAt: new Date().toISOString(),
    };
    const events = this.state.eventCache.get(hostId) ?? [];
    const limit = Math.max(0, this.config.eventCacheLimitPerHost);
    const nextEvents = [...events, cached];
    const retainedEvents = limit === 0 ? [] : nextEvents.slice(-limit);
    const droppedEvents = nextEvents.slice(0, nextEvents.length - retainedEvents.length);
    const latestDropped = droppedEvents.at(-1);
    if (latestDropped) {
      this.state.eventCacheDroppedThrough.set(hostId, latestDropped.sequence);
    }
    this.state.eventCache.set(hostId, retainedEvents);
    return cached;
  }

  readHostEvents(userId: UserId, hostId: HostId, afterSequence = 0): CachedRelayEvent[] {
    this.assertHostAccess(userId, hostId);
    return (this.state.eventCache.get(hostId) ?? []).filter(
      (event) => event.sequence > afterSequence,
    );
  }

  readHostEventReplay(userId: UserId, hostId: HostId, afterSequence = 0): HostEventReplay {
    this.assertHostAccess(userId, hostId);
    const events = this.state.eventCache.get(hostId) ?? [];
    const droppedThroughSequence = this.state.eventCacheDroppedThrough.get(hostId) ?? 0;
    const latestSequence = events.at(-1)?.sequence ?? afterSequence;

    if (afterSequence > 0 && afterSequence < droppedThroughSequence) {
      throw new RelayError(
        `Host event cache dropped events through sequence ${droppedThroughSequence}; cannot replay after sequence ${afterSequence}`,
        "HOST_EVENT_CACHE_GAP",
      );
    }

    return {
      events: events.filter((event) => event.sequence > afterSequence),
      latestSequence: Math.max(afterSequence, latestSequence),
    };
  }

  assertHostAccess(userId: UserId, hostId: HostId): HostAccess {
    this.requireUser(userId);
    this.requireHost(hostId);
    const access = this.state.hostAccess.find(
      (candidate) => candidate.userId === userId && candidate.hostId === hostId,
    );
    if (!access) {
      throw new RelayAuthzError();
    }
    return access;
  }

  getPublicBaseUrl(): string {
    return this.config.publicBaseUrl;
  }

  private requireUser(userId: UserId): User {
    const user = this.state.users.get(userId);
    if (!user) {
      throw new RelayNotFoundError(`User not found: ${userId}`);
    }
    return user;
  }

  private requireDevice(deviceId: DeviceId): Device {
    const device = this.state.devices.get(deviceId);
    if (!device) {
      throw new RelayNotFoundError(`Device not found: ${deviceId}`);
    }
    return device;
  }

  private requireHost(hostId: HostId): Host {
    const host = this.state.hosts.get(hostId);
    if (!host) {
      throw new RelayNotFoundError(`Host not found: ${hostId}`);
    }
    return host;
  }

  private requirePairingCode(code: string): HostPairingCode {
    const normalizedCode = normalizePairingCode(code);
    const pairingCode = this.state.hostPairingCodes.get(normalizedCode);
    if (!pairingCode) {
      throw new RelayAuthzError("Invalid Host pairing code");
    }
    return pairingCode;
  }
}

function normalizePairingCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

function formatPairingCode(rawCode: string): string {
  const normalized = normalizePairingCode(rawCode).slice(0, 8);
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}
