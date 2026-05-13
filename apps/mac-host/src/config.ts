import type { DeviceId, HostId, ProjectId, UserId } from "@codex-link/protocol";
import { spawn } from "node:child_process";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { readFile, stat } from "node:fs/promises";

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

export interface MacHostKeychainCredentialReference {
  service: string;
  account: string;
}

export interface MacHostCredentialStore {
  readDeviceToken(reference: MacHostKeychainCredentialReference): Promise<string>;
}

interface MacHostConfigDocument {
  relayUrl: string;
  userId: UserId;
  deviceId: DeviceId;
  deviceTokenSource: MacHostDeviceTokenSource;
  hostId: HostId;
  hostName: string;
  projects: MacHostProjectConfig[];
}

type MacHostDeviceTokenSource =
  | { kind: "inline"; token: string }
  | { kind: "keychain"; reference: MacHostKeychainCredentialReference };

interface RawMacHostProjectConfig {
  id?: unknown;
  name?: unknown;
  path?: unknown;
}

interface RawMacHostKeychainCredentialReference {
  service?: unknown;
  account?: unknown;
}

interface RawMacHostConfig {
  relayUrl?: unknown;
  userId?: unknown;
  deviceId?: unknown;
  deviceToken?: unknown;
  deviceTokenKeychain?: RawMacHostKeychainCredentialReference;
  hostId?: unknown;
  hostName?: string;
  projects?: RawMacHostProjectConfig[];
}

export function defaultMacHostConfigPath(): string {
  return join(homedir(), ".codex-link", "host.json");
}

export async function loadMacHostConfig(
  configPath = defaultMacHostConfigPath(),
  credentialStore?: MacHostCredentialStore,
): Promise<MacHostConfig> {
  await assertMacHostConfigFileMode(configPath);
  const raw = await readFile(configPath, "utf8");
  return resolveMacHostConfig(
    parseMacHostConfigDocument(JSON.parse(raw) as RawMacHostConfig),
    credentialStore,
  );
}

export async function assertMacHostConfigFileMode(configPath: string): Promise<void> {
  const info = await stat(configPath);
  if (!info.isFile()) {
    throw new Error(`Mac Host config path is not a file: ${configPath}`);
  }
  if (process.platform === "win32") {
    return;
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error(
      `Mac Host config may reference a device credential and must not be readable by group or others: ${configPath}. Run chmod 600 ${configPath}`,
    );
  }
}

export function parseMacHostConfig(input: RawMacHostConfig): MacHostConfig {
  const document = parseMacHostConfigDocument(input);
  if (document.deviceTokenSource.kind !== "inline") {
    throw new Error("Mac Host configs with deviceTokenKeychain must be loaded with loadMacHostConfig");
  }
  return macHostConfigWithDeviceToken(document, document.deviceTokenSource.token);
}

function parseMacHostConfigDocument(input: RawMacHostConfig): MacHostConfigDocument {
  const relayUrl = requiredString(input.relayUrl, "relayUrl");
  const userId = requiredString(input.userId, "userId") as UserId;
  const deviceId = requiredString(input.deviceId, "deviceId") as DeviceId;
  const deviceTokenSource = parseDeviceTokenSource(input);
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
    deviceTokenSource,
    hostId,
    hostName,
    projects: projects.map((project, index) => ({
      id: requiredString(project.id, `projects[${index}].id`) as ProjectId,
      name: requiredString(project.name, `projects[${index}].name`),
      path: requiredString(project.path, `projects[${index}].path`),
    })),
  };
}

async function resolveMacHostConfig(
  document: MacHostConfigDocument,
  credentialStore?: MacHostCredentialStore,
): Promise<MacHostConfig> {
  const deviceToken =
    document.deviceTokenSource.kind === "inline"
      ? document.deviceTokenSource.token
      : await (credentialStore ?? defaultMacHostCredentialStore()).readDeviceToken(
          document.deviceTokenSource.reference,
        );
  return macHostConfigWithDeviceToken(document, deviceToken);
}

function macHostConfigWithDeviceToken(
  document: MacHostConfigDocument,
  deviceToken: string,
): MacHostConfig {
  return {
    relayUrl: document.relayUrl,
    userId: document.userId,
    deviceId: document.deviceId,
    deviceToken,
    hostId: document.hostId,
    hostName: document.hostName,
    projects: document.projects,
  };
}

function parseDeviceTokenSource(input: RawMacHostConfig): MacHostDeviceTokenSource {
  if (input.deviceToken !== undefined && input.deviceTokenKeychain !== undefined) {
    throw new Error("Mac Host config must not set both deviceToken and deviceTokenKeychain");
  }
  if (input.deviceToken !== undefined) {
    return { kind: "inline", token: requiredString(input.deviceToken, "deviceToken") };
  }
  if (input.deviceTokenKeychain !== undefined) {
    if (
      typeof input.deviceTokenKeychain !== "object" ||
      input.deviceTokenKeychain === null ||
      Array.isArray(input.deviceTokenKeychain)
    ) {
      throw new Error("deviceTokenKeychain must be an object");
    }
    return {
      kind: "keychain",
      reference: {
        service: requiredString(input.deviceTokenKeychain.service, "deviceTokenKeychain.service"),
        account: requiredString(input.deviceTokenKeychain.account, "deviceTokenKeychain.account"),
      },
    };
  }
  throw new Error("Missing required Mac Host config field: deviceToken");
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required Mac Host config field: ${name}`);
  }
  return value;
}

function defaultMacHostCredentialStore(): MacHostCredentialStore {
  if (process.platform !== "darwin") {
    throw new Error("Mac Host deviceTokenKeychain requires macOS Keychain");
  }
  return new MacOSKeychainCredentialStore();
}

export class MacOSKeychainCredentialStore implements MacHostCredentialStore {
  async readDeviceToken(reference: MacHostKeychainCredentialReference): Promise<string> {
    const output = await runSecurity([
      "find-generic-password",
      "-a",
      reference.account,
      "-s",
      reference.service,
      "-w",
    ]);
    const token = output.stdout.replace(/\r?\n$/, "");
    if (token.length === 0) {
      throw new Error(
        `Mac Host device token Keychain item is empty: service=${reference.service} account=${reference.account}`,
      );
    }
    return token;
  }
}

async function runSecurity(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `security ${args[0] ?? "command"} failed with exit code ${code ?? "unknown"}: ${
            stderr.trim() || stdout.trim()
          }`,
        ),
      );
    });
  });
}
