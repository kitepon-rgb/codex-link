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
import { RelayAuthzError, RelayNotFoundError } from "./errors.js";
import { createId } from "./id.js";
import type { RelayConfig } from "./config.js";
import { loadRelayConfig } from "./config.js";
import type { CachedRelayEvent, RelayState } from "./state.js";
import { createRelayState } from "./state.js";

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
    events.push(cached);
    this.state.eventCache.set(
      hostId,
      events.slice(-this.config.eventCacheLimitPerHost),
    );
    return cached;
  }

  readHostEvents(userId: UserId, hostId: HostId, afterSequence = 0): CachedRelayEvent[] {
    this.assertHostAccess(userId, hostId);
    return (this.state.eventCache.get(hostId) ?? []).filter(
      (event) => event.sequence > afterSequence,
    );
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
}
