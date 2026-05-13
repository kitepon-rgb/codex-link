import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  Device,
  DeviceId,
  Host,
  HostAccess,
  HostId,
  User,
  UserId,
} from "@codex-link/protocol";
import type { DeviceCredential, HostPairingCode, RelayState } from "./state.js";

interface RelaySnapshotV1 {
  schema: 1;
  savedAt: string;
  users: Array<[UserId, User]>;
  devices: Array<[DeviceId, Device]>;
  hosts: Array<[HostId, Host]>;
  hostAccess: HostAccess[];
  deviceCredentials: Array<[DeviceId, DeviceCredential]>;
  hostPairingCodes: Array<[string, HostPairingCode]>;
  nextEventSequence: number;
  nextAuditSequence: number;
}

export async function loadRelaySnapshot(path: string, state: RelayState): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as RelaySnapshotV1;
  if (parsed.schema !== 1) {
    throw new Error(`Unsupported Relay snapshot schema: ${(parsed as { schema: unknown }).schema}`);
  }
  state.users = new Map(parsed.users);
  state.devices = new Map(parsed.devices);
  state.hosts = new Map(parsed.hosts);
  state.hostAccess = [...parsed.hostAccess];
  state.deviceCredentials = new Map(parsed.deviceCredentials);
  state.hostPairingCodes = new Map(parsed.hostPairingCodes);
  state.nextEventSequence = Math.max(parsed.nextEventSequence, state.nextEventSequence);
  state.nextAuditSequence = Math.max(parsed.nextAuditSequence, state.nextAuditSequence);
  return true;
}

export async function saveRelaySnapshot(path: string, state: RelayState): Promise<void> {
  const snapshot: RelaySnapshotV1 = {
    schema: 1,
    savedAt: new Date().toISOString(),
    users: [...state.users.entries()],
    devices: [...state.devices.entries()],
    hosts: [...state.hosts.entries()],
    hostAccess: state.hostAccess,
    deviceCredentials: [...state.deviceCredentials.entries()],
    hostPairingCodes: [...state.hostPairingCodes.entries()],
    nextEventSequence: state.nextEventSequence,
    nextAuditSequence: state.nextAuditSequence,
  };
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, JSON.stringify(snapshot, null, 2), "utf8");
  await rename(tempPath, path);
}

export interface RelayPersistenceController {
  flushNow(): Promise<void>;
  stop(): Promise<void>;
}

export function startRelayPersistence(
  state: RelayState,
  path: string,
  intervalMs: number = 2_000,
): RelayPersistenceController {
  let lastSerialized = "";
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const flush = async () => {
    if (stopped) return;
    if (inFlight) return inFlight;
    const promise = (async () => {
      try {
        const serialized = JSON.stringify({
          u: [...state.users.keys()],
          d: [...state.devices.keys()],
          h: [...state.hosts.keys()],
          a: state.hostAccess.length,
          c: [...state.deviceCredentials.keys()],
          p: [...state.hostPairingCodes.keys()],
          s: state.nextEventSequence,
          x: state.nextAuditSequence,
        });
        if (serialized === lastSerialized) return;
        await saveRelaySnapshot(path, state);
        lastSerialized = serialized;
      } catch (error) {
        console.error(`Relay snapshot save failed at ${path}:`, error);
      }
    })();
    inFlight = promise;
    try {
      await promise;
    } finally {
      inFlight = null;
    }
  };

  const timer = setInterval(() => {
    void flush();
  }, intervalMs);
  timer.unref?.();

  return {
    flushNow: flush,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await flush();
    },
  };
}
