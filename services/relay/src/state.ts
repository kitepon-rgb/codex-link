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

export interface RelayState {
  users: Map<UserId, User>;
  devices: Map<DeviceId, Device>;
  hosts: Map<HostId, Host>;
  hostAccess: HostAccess[];
  connections: Map<ConnectionId, Connection>;
  eventCache: Map<HostId, CachedRelayEvent[]>;
  nextEventSequence: number;
}

export function createRelayState(): RelayState {
  return {
    users: new Map(),
    devices: new Map(),
    hosts: new Map(),
    hostAccess: [],
    connections: new Map(),
    eventCache: new Map(),
    nextEventSequence: 1,
  };
}
