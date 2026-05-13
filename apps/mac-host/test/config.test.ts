import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMacHostConfig, parseMacHostConfig, type MacHostCredentialStore } from "../src/index.js";

describe("parseMacHostConfig", () => {
  it("requires Relay and identity fields", () => {
    expect(() => parseMacHostConfig({})).toThrow("relayUrl");
  });

  it("parses a configured project", () => {
    expect(
      parseMacHostConfig({
        relayUrl: "ws://127.0.0.1:3000",
        userId: "usr_1",
        deviceId: "dev_1",
        deviceToken: "device_token_1",
        hostId: "host_1",
        hostName: "MacBook",
        projects: [{ id: "project_1", name: "Codex Link", path: "/repo" }],
      }),
    ).toEqual({
      relayUrl: "ws://127.0.0.1:3000",
      userId: "usr_1",
      deviceId: "dev_1",
      deviceToken: "device_token_1",
      hostId: "host_1",
      hostName: "MacBook",
      projects: [{ id: "project_1", name: "Codex Link", path: "/repo" }],
    });
  });

  it("requires loadMacHostConfig for Keychain-backed device tokens", () => {
    expect(() =>
      parseMacHostConfig({
        relayUrl: "ws://127.0.0.1:3000",
        userId: "usr_1",
        deviceId: "dev_1",
        deviceTokenKeychain: {
          service: "dev.codex-link.mac-host.device-token",
          account: "host_1:dev_1",
        },
        hostId: "host_1",
        hostName: "MacBook",
        projects: [{ id: "project_1", name: "Codex Link", path: "/repo" }],
      }),
    ).toThrow("must be loaded with loadMacHostConfig");
  });

  it("rejects ambiguous inline and Keychain device token sources", () => {
    expect(() =>
      parseMacHostConfig({
        relayUrl: "ws://127.0.0.1:3000",
        userId: "usr_1",
        deviceId: "dev_1",
        deviceToken: "device_token_1",
        deviceTokenKeychain: {
          service: "dev.codex-link.mac-host.device-token",
          account: "host_1:dev_1",
        },
        hostId: "host_1",
      }),
    ).toThrow("must not set both deviceToken and deviceTokenKeychain");
  });

  it("loads config files that are private to the current user", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-link-host-config-"));
    try {
      const configPath = join(dir, "host.json");
      await writeFile(configPath, JSON.stringify({
        relayUrl: "ws://127.0.0.1:3000",
        userId: "usr_1",
        deviceId: "dev_1",
        deviceToken: "device_token_1",
        hostId: "host_1",
        hostName: "MacBook",
        projects: [{ id: "project_1", name: "Codex Link", path: "/repo" }],
      }));
      await chmod(configPath, 0o600);

      await expect(loadMacHostConfig(configPath)).resolves.toMatchObject({
        deviceToken: "device_token_1",
        hostId: "host_1",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads Keychain-backed device tokens through the configured credential store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-link-host-config-"));
    const credentialStore: MacHostCredentialStore = {
      async readDeviceToken(reference) {
        expect(reference).toEqual({
          service: "dev.codex-link.mac-host.device-token",
          account: "host_1:dev_1",
        });
        return "device_token_from_keychain";
      },
    };
    try {
      const configPath = join(dir, "host.json");
      await writeFile(configPath, JSON.stringify({
        relayUrl: "ws://127.0.0.1:3000",
        userId: "usr_1",
        deviceId: "dev_1",
        deviceTokenKeychain: {
          service: "dev.codex-link.mac-host.device-token",
          account: "host_1:dev_1",
        },
        hostId: "host_1",
        hostName: "MacBook",
        projects: [{ id: "project_1", name: "Codex Link", path: "/repo" }],
      }));
      await chmod(configPath, 0o600);

      await expect(loadMacHostConfig(configPath, credentialStore)).resolves.toMatchObject({
        deviceToken: "device_token_from_keychain",
        hostId: "host_1",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects Host config files readable by group or others", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-link-host-config-"));
    try {
      const configPath = join(dir, "host.json");
      await writeFile(configPath, "{}");
      await chmod(configPath, 0o644);

      await expect(loadMacHostConfig(configPath)).rejects.toThrow(
        "must not be readable by group or others",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
