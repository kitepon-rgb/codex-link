import type {
  CodexLinkEvent,
  Connection,
  Device,
  DeviceId,
  Host,
  HostAccess,
  HostChatGptAccount,
  HostId,
  User,
  UserId,
} from "@codex-link/protocol";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  RelayAuthnError,
  RelayAuthzError,
  RelayError,
  RelayNotFoundError,
} from "./errors.js";
import { createId } from "./id.js";
import type { RelayConfig } from "./config.js";
import { loadRelayConfig } from "./config.js";
import type {
  CachedRelayEvent,
  HostPairingCode,
  RelayAuditEvent,
  RelayAuditOutcome,
  RelayState,
} from "./state.js";
import { createRelayState } from "./state.js";

const DEFAULT_PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_AUDIT_EVENT_LIMIT = 1000;
const DEFAULT_MAX_HTTP_BODY_BYTES = 64 * 1024;
const DEFAULT_MAX_WEBSOCKET_PAYLOAD_BYTES = 1024 * 1024;
const DEFAULT_DEVICE_CREDENTIAL_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type ShareableHostAccessRole = Exclude<HostAccess["role"], "owner">;

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
  deviceToken: string;
  expiresAt: string;
  host: Host;
}

export interface PlaceholderDeviceSession {
  user: User;
  device: Device;
  deviceToken: string;
  expiresAt: string;
}

export interface HostPairingGrant {
  user: User;
  device: Device;
  host: Host;
  access: HostAccess;
  chatgptAccount?: HostChatGptAccount;
}

export interface HostAccessGrant {
  owner: User;
  targetUser: User;
  host: Host;
  access: HostAccess;
}

export interface HostAccessRevocation {
  owner: User;
  targetUser: User;
  host: Host;
  revokedAccess: HostAccess;
}

export interface DeviceRevocation {
  user: User;
  device: Device;
}

export interface DeviceCredentialIssue {
  user: User;
  device: Device;
  token: string;
  expiresAt: string;
}

export interface HostEventReplay {
  events: CachedRelayEvent[];
  latestSequence: number;
}

export interface RelayRateLimitResult {
  remaining: number;
  resetAt: string;
}

export interface RelayAuditEventFilter {
  action?: string;
  outcome?: RelayAuditOutcome;
  userId?: UserId;
  deviceId?: DeviceId;
  hostId?: HostId;
  limit?: number;
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
    this.recordAudit({
      action: "device.registered",
      outcome: "success",
      userId,
      deviceId: device.id,
      detail: { kind },
    });
    return device;
  }

  issueDeviceCredential(input: {
    userId: UserId;
    deviceId: DeviceId;
    now?: Date;
  }): DeviceCredentialIssue {
    const user = this.requireUser(input.userId);
    const device = this.requireDevice(input.deviceId);
    if (device.userId !== user.id) {
      throw new RelayAuthzError("Only the owning user can issue a device credential");
    }
    if (device.revokedAt) {
      throw new RelayAuthzError("Revoked device cannot receive a credential");
    }
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + this.getDeviceCredentialTtlMs()).toISOString();
    const token = randomBytes(32).toString("base64url");
    this.state.deviceCredentials.set(device.id, {
      deviceId: device.id,
      tokenHash: hashDeviceToken(token),
      createdAt: now.toISOString(),
      expiresAt,
    });
    this.recordAudit({
      action: "device.credential.issued",
      outcome: "success",
      userId: user.id,
      deviceId: device.id,
      detail: { kind: device.kind, expiresAt },
    });
    return { user, device, token, expiresAt };
  }

  rotateDeviceCredential(input: {
    userId: UserId;
    deviceId: DeviceId;
    now?: Date;
  }): DeviceCredentialIssue {
    const user = this.requireUser(input.userId);
    const device = this.requireDevice(input.deviceId);
    if (device.userId !== user.id) {
      this.recordAudit({
        action: "device.credential.rotation.denied",
        outcome: "denied",
        userId: user.id,
        deviceId: device.id,
        detail: { reason: "user_device_mismatch" },
      });
      throw new RelayAuthzError("Only the owning user can rotate a device credential");
    }
    if (device.revokedAt) {
      this.recordAudit({
        action: "device.credential.rotation.denied",
        outcome: "denied",
        userId: user.id,
        deviceId: device.id,
        detail: { reason: "revoked_device" },
      });
      throw new RelayAuthzError("Revoked device cannot rotate a credential");
    }
    const credentialInput: { userId: UserId; deviceId: DeviceId; now?: Date } = {
      userId: user.id,
      deviceId: device.id,
    };
    if (input.now) {
      credentialInput.now = input.now;
    }
    const credential = this.issueDeviceCredential(credentialInput);
    this.recordAudit({
      action: "device.credential.rotated",
      outcome: "success",
      userId: user.id,
      deviceId: device.id,
      detail: { kind: device.kind, expiresAt: credential.expiresAt },
    });
    return credential;
  }

  registerHost(ownerUserId: UserId, deviceId: DeviceId, name: string): Host {
    const device = this.requireDevice(deviceId);
    if (device.revokedAt) {
      throw new RelayAuthzError("Revoked device cannot register a Host");
    }
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
    this.recordAudit({
      action: "host.registered",
      outcome: "success",
      userId: ownerUserId,
      deviceId,
      hostId: host.id,
    });
    this.recordAudit({
      action: "host.access.granted",
      outcome: "success",
      userId: ownerUserId,
      hostId: host.id,
      detail: { role: "owner" },
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
    const credential = this.issueDeviceCredential({ userId: user.id, deviceId: device.id });
    const host = this.registerHost(user.id, device.id, input.hostName);
    return { user, device, deviceToken: credential.token, expiresAt: credential.expiresAt, host };
  }

  registerPlaceholderIphoneSession(displayName: string, deviceName: string): PlaceholderDeviceSession {
    const user = this.loginPlaceholder(displayName);
    const device = this.registerDevice(user.id, deviceName, "iphone");
    const credential = this.issueDeviceCredential({ userId: user.id, deviceId: device.id });
    return { user, device, deviceToken: credential.token, expiresAt: credential.expiresAt };
  }

  revokeDevice(input: { userId: UserId; deviceId: DeviceId; now?: Date }): DeviceRevocation {
    const user = this.requireUser(input.userId);
    const device = this.requireDevice(input.deviceId);
    if (device.userId !== user.id) {
      this.recordAudit({
        action: "device.revocation.denied",
        outcome: "denied",
        userId: user.id,
        deviceId: device.id,
      });
      throw new RelayAuthzError("Only the owning user can revoke a device");
    }
    device.revokedAt = device.revokedAt ?? (input.now ?? new Date()).toISOString();
    this.state.deviceCredentials.delete(device.id);
    if (device.kind === "mac-host") {
      for (const host of this.state.hosts.values()) {
        if (host.deviceId === device.id) {
          host.status = "offline";
        }
      }
    }
    this.recordAudit({
      action: "device.revoked",
      outcome: "success",
      userId: user.id,
      deviceId: device.id,
      detail: { kind: device.kind, revokedAt: device.revokedAt },
    });
    return { user, device };
  }

  createHostPairingCode(
    hostId: HostId,
    options: { now?: Date; ttlMs?: number } = {},
  ): HostPairingCode {
    const host = this.requireHost(hostId);
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
    if (host.chatgptAccount) {
      pairingCode.chatgptEmail = host.chatgptAccount.email;
      pairingCode.chatgptPlanType = host.chatgptAccount.planType;
    }
    this.state.hostPairingCodes.set(normalizePairingCode(code), pairingCode);
    this.recordAudit({
      action: "host.pairing_code.created",
      outcome: "success",
      hostId,
      detail: {
        expiresAt,
        chatgptEmail: host.chatgptAccount?.email ?? null,
      },
    });
    return pairingCode;
  }

  updateHostChatGptAccount(
    hostId: HostId,
    account: HostChatGptAccount | null,
  ): Host {
    const host = this.requireHost(hostId);
    if (account) {
      host.chatgptAccount = account;
    } else {
      delete host.chatgptAccount;
    }
    this.recordAudit({
      action: "host.account.updated",
      outcome: "success",
      hostId,
      detail: {
        chatgptEmail: account?.email ?? null,
      },
    });
    return host;
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
    this.recordAudit({
      action: "host.pairing_code.redeemed",
      outcome: "success",
      userId: user.id,
      deviceId: device.id,
      hostId: host.id,
      detail: {
        chatgptEmail:
          host.chatgptAccount?.email ?? pairingCode.chatgptEmail ?? null,
      },
    });
    const grant: HostPairingGrant = { user, device, host, access };
    const chatgptAccount = host.chatgptAccount ?? (pairingCode.chatgptEmail
      ? { email: pairingCode.chatgptEmail, planType: pairingCode.chatgptPlanType ?? null }
      : null);
    if (chatgptAccount) {
      grant.chatgptAccount = chatgptAccount;
    }
    return grant;
  }

  grantHostAccess(hostId: HostId, userId: UserId, role: HostAccess["role"]): HostAccess {
    this.requireHost(hostId);
    this.requireUser(userId);
    const existing = this.state.hostAccess.find(
      (access) => access.hostId === hostId && access.userId === userId,
    );
    if (existing) {
      if (existing.role === "owner" && role !== "owner") {
        this.recordAudit({
          action: "host.access.retained",
          outcome: "success",
          userId,
          hostId,
          detail: { role: existing.role, requestedRole: role },
        });
        return existing;
      }
      existing.role = role;
      this.recordAudit({
        action: "host.access.updated",
        outcome: "success",
        userId,
        hostId,
        detail: { role },
      });
      return existing;
    }
    const access: HostAccess = { hostId, userId, role };
    this.state.hostAccess.push(access);
    this.recordAudit({
      action: "host.access.granted",
      outcome: "success",
      userId,
      hostId,
      detail: { role },
    });
    return access;
  }

  grantHostAccessByOwner(input: {
    ownerUserId: UserId;
    hostId: HostId;
    targetUserId: UserId;
    role: ShareableHostAccessRole;
  }): HostAccessGrant {
    const owner = this.requireUser(input.ownerUserId);
    const targetUser = this.requireUser(input.targetUserId);
    const host = this.requireHost(input.hostId);
    this.assertHostOwner(owner.id, host.id, "host.access.grant.denied");
    const access = this.grantHostAccess(host.id, targetUser.id, input.role);
    this.recordAudit({
      action: "host.access.shared",
      outcome: "success",
      userId: owner.id,
      hostId: host.id,
      detail: { targetUserId: targetUser.id, role: input.role },
    });
    return { owner, targetUser, host, access };
  }

  revokeHostAccessByOwner(input: {
    ownerUserId: UserId;
    hostId: HostId;
    targetUserId: UserId;
  }): HostAccessRevocation {
    const owner = this.requireUser(input.ownerUserId);
    const targetUser = this.requireUser(input.targetUserId);
    const host = this.requireHost(input.hostId);
    this.assertHostOwner(owner.id, host.id, "host.access.revoke.denied");
    const accessIndex = this.state.hostAccess.findIndex(
      (access) => access.hostId === host.id && access.userId === targetUser.id,
    );
    if (accessIndex === -1) {
      throw new RelayNotFoundError("HostAccess not found");
    }
    const revokedAccess = this.state.hostAccess[accessIndex]!;
    if (revokedAccess.role === "owner") {
      this.recordAudit({
        action: "host.access.revoke.denied",
        outcome: "denied",
        userId: owner.id,
        hostId: host.id,
        detail: { targetUserId: targetUser.id, reason: "owner_access" },
      });
      throw new RelayAuthzError("Host owner access cannot be revoked through sharing");
    }
    this.state.hostAccess.splice(accessIndex, 1);
    this.recordAudit({
      action: "host.access.revoked",
      outcome: "success",
      userId: owner.id,
      hostId: host.id,
      detail: { targetUserId: targetUser.id, role: revokedAccess.role },
    });
    return { owner, targetUser, host, revokedAccess };
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
    const device = this.assertActiveDevice(deviceId);
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
    const device = this.assertActiveDevice(deviceId);
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
    const access = this.assertHostOperatorAccess(userId, hostId);
    this.recordAudit({
      action: "host.route.authorized",
      outcome: "success",
      userId,
      hostId,
      detail: { role: access.role },
    });
    return { userId, hostId, payload };
  }

  checkRateLimit(input: {
    scope: string;
    key: string;
    now?: Date;
  }): RelayRateLimitResult {
    const limit = Math.max(1, this.config.rateLimitMaxRequestsPerWindow ?? 120);
    const windowMs = Math.max(1, this.config.rateLimitWindowMs ?? 60_000);
    const now = input.now ?? new Date();
    const nowMs = now.getTime();
    const bucketKey = `${input.scope}:${input.key}`;
    let bucket = this.state.rateLimitBuckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= nowMs) {
      bucket = {
        count: 0,
        resetAt: nowMs + windowMs,
      };
      this.state.rateLimitBuckets.set(bucketKey, bucket);
    }
    if (bucket.count >= limit) {
      this.recordAudit({
        action: "rate_limit.denied",
        outcome: "denied",
        detail: {
          scope: input.scope,
          key: input.key,
          resetAt: new Date(bucket.resetAt).toISOString(),
        },
      });
      throw new RelayError("Rate limit exceeded", "RATE_LIMITED");
    }
    bucket.count += 1;
    return {
      remaining: limit - bucket.count,
      resetAt: new Date(bucket.resetAt).toISOString(),
    };
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
      this.recordAudit({
        action: "host.event_replay.denied",
        outcome: "denied",
        userId,
        hostId,
        detail: { afterSequence, droppedThroughSequence },
      });
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
      this.recordAudit({
        action: "host.access.denied",
        outcome: "denied",
        userId,
        hostId,
      });
      throw new RelayAuthzError();
    }
    return access;
  }

  private assertHostOperatorAccess(userId: UserId, hostId: HostId): HostAccess {
    const access = this.assertHostAccess(userId, hostId);
    if (access.role !== "owner" && access.role !== "operator") {
      this.recordAudit({
        action: "host.route.denied",
        outcome: "denied",
        userId,
        hostId,
        detail: { role: access.role },
      });
      throw new RelayAuthzError("Host operator access is required");
    }
    return access;
  }

  private assertHostOwner(userId: UserId, hostId: HostId, deniedAction: string): HostAccess {
    const access = this.assertHostAccess(userId, hostId);
    if (access.role !== "owner") {
      this.recordAudit({
        action: deniedAction,
        outcome: "denied",
        userId,
        hostId,
        detail: { role: access.role },
      });
      throw new RelayAuthzError("Host owner access is required");
    }
    return access;
  }

  listAuditEvents(filter: RelayAuditEventFilter = {}): RelayAuditEvent[] {
    let events = [...this.state.auditEvents];
    if (filter.action) {
      events = events.filter((event) => event.action === filter.action);
    }
    if (filter.outcome) {
      events = events.filter((event) => event.outcome === filter.outcome);
    }
    if (filter.userId) {
      events = events.filter((event) => event.userId === filter.userId);
    }
    if (filter.deviceId) {
      events = events.filter((event) => event.deviceId === filter.deviceId);
    }
    if (filter.hostId) {
      events = events.filter((event) => event.hostId === filter.hostId);
    }
    if (filter.limit !== undefined) {
      const limit = Math.max(0, filter.limit);
      events = limit === 0 ? [] : events.slice(-limit);
    }
    return events;
  }

  assertActiveDevice(deviceId: DeviceId): Device {
    const device = this.requireDevice(deviceId);
    if (device.revokedAt) {
      throw new RelayAuthzError("Revoked device cannot connect");
    }
    return device;
  }

  authenticateDevice(
    deviceId: DeviceId,
    token: string | null,
    options: { now?: Date } = {},
  ): Device {
    if (!token) {
      this.recordAudit({
        action: "device.authentication.denied",
        outcome: "denied",
        deviceId,
        detail: { reason: "missing_credential" },
      });
      throw new RelayAuthnError("Device credential required");
    }
    const device = this.assertActiveDevice(deviceId);
    const credential = this.state.deviceCredentials.get(deviceId);
    if (!credential || !safeEqualHex(credential.tokenHash, hashDeviceToken(token))) {
      this.recordAudit({
        action: "device.authentication.denied",
        outcome: "denied",
        userId: device.userId,
        deviceId,
        detail: { reason: "invalid_credential" },
      });
      throw new RelayAuthnError("Invalid device credential");
    }
    const now = options.now ?? new Date();
    if (Date.parse(credential.expiresAt) <= now.getTime()) {
      this.recordAudit({
        action: "device.authentication.denied",
        outcome: "denied",
        userId: device.userId,
        deviceId,
        detail: { reason: "expired_credential", expiresAt: credential.expiresAt },
      });
      throw new RelayAuthnError("Expired device credential");
    }
    return device;
  }

  authenticateUserDevice(
    userId: UserId,
    deviceId: DeviceId,
    token: string | null,
    options: { now?: Date } = {},
  ): Device {
    this.requireUser(userId);
    const device = this.authenticateDevice(deviceId, token, options);
    if (device.userId !== userId) {
      this.recordAudit({
        action: "device.authentication.denied",
        outcome: "denied",
        userId,
        deviceId,
        detail: { reason: "user_device_mismatch" },
      });
      throw new RelayAuthzError("Device does not belong to the user");
    }
    return device;
  }

  getPublicBaseUrl(): string {
    return this.config.publicBaseUrl;
  }

  getMaxHttpBodyBytes(): number {
    const configuredLimit = this.config.maxHttpBodyBytes ?? DEFAULT_MAX_HTTP_BODY_BYTES;
    return Number.isFinite(configuredLimit)
      ? Math.max(1, configuredLimit)
      : DEFAULT_MAX_HTTP_BODY_BYTES;
  }

  getMaxWebSocketPayloadBytes(): number {
    const configuredLimit =
      this.config.maxWebSocketPayloadBytes ?? DEFAULT_MAX_WEBSOCKET_PAYLOAD_BYTES;
    return Number.isFinite(configuredLimit)
      ? Math.max(1, configuredLimit)
      : DEFAULT_MAX_WEBSOCKET_PAYLOAD_BYTES;
  }

  getDeviceCredentialTtlMs(): number {
    const configuredTtl = this.config.deviceCredentialTtlMs ?? DEFAULT_DEVICE_CREDENTIAL_TTL_MS;
    return Number.isFinite(configuredTtl)
      ? Math.max(60_000, configuredTtl)
      : DEFAULT_DEVICE_CREDENTIAL_TTL_MS;
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

  private recordAudit(input: {
    action: string;
    outcome: RelayAuditOutcome;
    userId?: UserId;
    deviceId?: DeviceId;
    hostId?: HostId;
    detail?: Record<string, string | number | boolean | null>;
  }): RelayAuditEvent {
    const event: RelayAuditEvent = {
      sequence: this.state.nextAuditSequence++,
      action: input.action,
      outcome: input.outcome,
      occurredAt: new Date().toISOString(),
    };
    if (input.userId) {
      event.userId = input.userId;
    }
    if (input.deviceId) {
      event.deviceId = input.deviceId;
    }
    if (input.hostId) {
      event.hostId = input.hostId;
    }
    if (input.detail) {
      event.detail = input.detail;
    }
    this.state.auditEvents.push(event);
    const configuredLimit = this.config.auditEventLimit ?? DEFAULT_AUDIT_EVENT_LIMIT;
    const limit = Number.isFinite(configuredLimit)
      ? Math.max(0, configuredLimit)
      : DEFAULT_AUDIT_EVENT_LIMIT;
    if (limit === 0) {
      this.state.auditEvents.length = 0;
    } else if (this.state.auditEvents.length > limit) {
      this.state.auditEvents.splice(0, this.state.auditEvents.length - limit);
    }
    return event;
  }
}

function normalizePairingCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

function formatPairingCode(rawCode: string): string {
  const normalized = normalizePairingCode(rawCode).slice(0, 8);
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqualHex(first: string, second: string): boolean {
  const firstBuffer = Buffer.from(first, "hex");
  const secondBuffer = Buffer.from(second, "hex");
  if (firstBuffer.length !== secondBuffer.length) {
    return false;
  }
  return timingSafeEqual(firstBuffer, secondBuffer);
}
