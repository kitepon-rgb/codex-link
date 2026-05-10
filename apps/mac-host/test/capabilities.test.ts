import type { CodexAppServerClient } from "@codex-link/codex-client";
import { describe, expect, it } from "vitest";
import { readCodexAppServerCapabilities, type MacHostConfig } from "../src/index.js";

describe("readCodexAppServerCapabilities", () => {
  it("reads model, experimental feature, and config capabilities from app-server", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const codex = fakeCodexClient(async (method, params) => {
      requests.push({ method, params });
      return { method };
    });

    await expect(
      readCodexAppServerCapabilities(codex, {
        relayUrl: "ws://127.0.0.1:3000",
        userId: "usr_1" as never,
        deviceId: "dev_1" as never,
        hostId: "host_1" as never,
        hostName: "MacBook",
        projects: [{ id: "project_1" as never, name: "Codex Link", path: "/repo" }],
      } satisfies MacHostConfig),
    ).resolves.toEqual({
      models: { method: "model/list" },
      experimentalFeatures: { method: "experimentalFeature/list" },
      config: { method: "config/read" },
    });

    expect(requests).toEqual([
      { method: "model/list", params: { includeHidden: true } },
      { method: "experimentalFeature/list", params: {} },
      { method: "config/read", params: { includeLayers: true, cwd: "/repo" } },
    ]);
  });
});

function fakeCodexClient(
  requestHandler: (method: string, params?: unknown) => Promise<unknown>,
): CodexAppServerClient {
  return {
    start: async () => undefined,
    initialize: async () => ({}),
    request: requestHandler,
    startThread: (params) => requestHandler("thread/start", params),
    startTurn: (params) => requestHandler("turn/start", params),
    steerTurn: (params) => requestHandler("turn/steer", params),
    interruptTurn: (params) => requestHandler("turn/interrupt", params),
    listModels: (params) => requestHandler("model/list", params),
    listExperimentalFeatures: (params) =>
      requestHandler("experimentalFeature/list", params),
    readConfig: (params) => requestHandler("config/read", params),
    listThreads: (params) => requestHandler("thread/list", params),
    readThread: (params) => requestHandler("thread/read", params),
    listThreadTurns: (params) => requestHandler("thread/turns/list", params),
    respondToServerRequest: () => undefined,
    notify: () => undefined,
    close: async () => undefined,
  };
}
