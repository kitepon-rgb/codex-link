import { describe, expect, it } from "vitest";
import { parseMacHostConfig } from "../src/index.js";

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
        hostId: "host_1",
        hostName: "MacBook",
        projects: [{ id: "project_1", name: "Codex Link", path: "/repo" }],
      }),
    ).toEqual({
      relayUrl: "ws://127.0.0.1:3000",
      userId: "usr_1",
      deviceId: "dev_1",
      hostId: "host_1",
      hostName: "MacBook",
      projects: [{ id: "project_1", name: "Codex Link", path: "/repo" }],
    });
  });
});
