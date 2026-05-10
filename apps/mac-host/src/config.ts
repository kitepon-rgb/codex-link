import type { DeviceId, HostId, ProjectId, UserId } from "@codex-link/protocol";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export interface MacHostProjectConfig {
  id: ProjectId;
  name: string;
  path: string;
}

export interface MacHostConfig {
  relayUrl: string;
  userId: UserId;
  deviceId: DeviceId;
  deviceToken: string;
  hostId: HostId;
  hostName: string;
  projects: MacHostProjectConfig[];
}

interface RawMacHostProjectConfig {
  id?: unknown;
  name?: unknown;
  path?: unknown;
}

interface RawMacHostConfig {
  relayUrl?: unknown;
  userId?: unknown;
  deviceId?: unknown;
  deviceToken?: unknown;
  hostId?: unknown;
  hostName?: string;
  projects?: RawMacHostProjectConfig[];
}

export function defaultMacHostConfigPath(): string {
  return join(homedir(), ".codex-link", "host.json");
}

export async function loadMacHostConfig(
  configPath = defaultMacHostConfigPath(),
): Promise<MacHostConfig> {
  const raw = await readFile(configPath, "utf8");
  return parseMacHostConfig(JSON.parse(raw) as RawMacHostConfig);
}

export function parseMacHostConfig(input: RawMacHostConfig): MacHostConfig {
  const relayUrl = requiredString(input.relayUrl, "relayUrl");
  const userId = requiredString(input.userId, "userId") as UserId;
  const deviceId = requiredString(input.deviceId, "deviceId") as DeviceId;
  const deviceToken = requiredString(input.deviceToken, "deviceToken");
  const hostId = requiredString(input.hostId, "hostId") as HostId;
  const hostName = input.hostName ?? hostname();
  const projects = input.projects ?? [];
  if (!Array.isArray(projects)) {
    throw new Error("projects must be an array");
  }
  return {
    relayUrl,
    userId,
    deviceId,
    deviceToken,
    hostId,
    hostName,
    projects: projects.map((project, index) => ({
      id: requiredString(project.id, `projects[${index}].id`) as ProjectId,
      name: requiredString(project.name, `projects[${index}].name`),
      path: requiredString(project.path, `projects[${index}].path`),
    })),
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required Mac Host config field: ${name}`);
  }
  return value;
}
