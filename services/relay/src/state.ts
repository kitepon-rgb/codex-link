import type {
  CodexLinkEvent,
  Connection,
  ConnectionId,
  Device,
  DeviceId,
  Host,
  HostAccess,
  HostId,
  User,
  UserId,
} from "@codex-link/protocol";

export interface CachedRelayEvent {
  sequence: number;
  hostId: HostId;
  event: CodexLinkEvent;
  receivedAt: string;
}

export interface HostPairingCode {
  code: string;
  hostId: HostId;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export type RelayAuditOutcome = "success" | "denied" | "failed";

export interface RelayAuditEvent {
  sequence: number;
  action: string;
  outcome: RelayAuditOutcome;
  occurredAt: string;
  userId?: UserId;
  deviceId?: DeviceId;
  hostId?: HostId;
  detail?: Record<string, string | number | boolean | null>;
}

export interface RelayRateLimitBucket {
  count: number;
  resetAt: number;
}

export interface DeviceCredential {
  deviceId: DeviceId;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface RelayState {
  users: Map<UserId, User>;
  devices: Map<DeviceId, Device>;
  hosts: Map<HostId, Host>;
  hostAccess: HostAccess[];
  connections: Map<ConnectionId, Connection>;
  eventCache: Map<HostId, CachedRelayEvent[]>;
  eventCacheDroppedThrough: Map<HostId, number>;
  hostPairingCodes: Map<string, HostPairingCode>;
  auditEvents: RelayAuditEvent[];
  rateLimitBuckets: Map<string, RelayRateLimitBucket>;
  deviceCredentials: Map<DeviceId, DeviceCredential>;
  nextEventSequence: number;
  nextAuditSequence: number;
}

export function createRelayState(): RelayState {
  return {
    users: new Map(),
    devices: new Map(),
    hosts: new Map(),
    hostAccess: [],
    connections: new Map(),
    eventCache: new Map(),
    eventCacheDroppedThrough: new Map(),
    hostPairingCodes: new Map(),
    auditEvents: [],
    rateLimitBuckets: new Map(),
    deviceCredentials: new Map(),
    nextEventSequence: 1,
    nextAuditSequence: 1,
  };
}
