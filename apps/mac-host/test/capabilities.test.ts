import type { CodexAppServerClient } from "@codex-link/codex-client";
import { describe, expect, it } from "vitest";
import { readCodexAppServerCapabilities, type MacHostConfig } from "../src/index.js";

describe("readCodexAppServerCapabilities", () => {
  it("reads model, experimental feature, and config capabilities from app-server", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const codex = fakeCodexClient(async (method, params) => {
      requests.push({ method, params });
      if (method === "model/list") {
        return {
          data: [
            {
              id: "gpt-test",
              displayName: "GPT Test",
              description: "Test model",
              hidden: false,
              isDefault: true,
              defaultReasoningEffort: "medium",
              availabilityNux: { message: "do not relay" },
            },
          ],
          nextCursor: null,
        };
      }
      if (method === "experimentalFeature/list") {
        return {
          data: [
            {
              name: "shell_tool",
              stage: "stable",
              displayName: "Shell tool",
              enabled: true,
              defaultEnabled: true,
              announcement: "do not relay",
            },
          ],
        };
      }
      if (method === "config/read") {
        return {
          config: {
            model: "gpt-test",
            model_reasoning_effort: "medium",
            approval_policy: "on-request",
            sandbox_mode: "workspace-write",
            features: {
              shell_tool: true,
              remote_control: false,
              note: "do not relay",
            },
            projects: {
              "/repo": {
                trust_level: "trusted",
                local_secret: "do not relay",
              },
            },
            mcp_servers: {
              private: { url: "https://private.example.test/mcp" },
            },
          },
          origins: { model: { file: "/Users/me/.codex/config.toml" } },
          layers: [{ config: { secret: "do not relay" } }],
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    });

    await expect(
      readCodexAppServerCapabilities(codex, {
        relayUrl: "ws://127.0.0.1:3000",
        userId: "usr_1" as never,
        deviceId: "dev_1" as never,
        deviceToken: "device_token_1",
        hostId: "host_1" as never,
        hostName: "MacBook",
        projects: [{ id: "project_1" as never, name: "Codex Link", path: "/repo" }],
      } satisfies MacHostConfig),
    ).resolves.toEqual({
      models: {
        data: [
          {
            id: "gpt-test",
            displayName: "GPT Test",
            description: "Test model",
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "medium",
          },
        ],
        nextCursor: null,
      },
      experimentalFeatures: {
        data: [
          {
            name: "shell_tool",
            stage: "stable",
            displayName: "Shell tool",
            enabled: true,
            defaultEnabled: true,
          },
        ],
      },
      config: {
        model: "gpt-test",
        modelReasoningEffort: "medium",
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
        features: {
          shell_tool: true,
          remote_control: false,
        },
        projectTrustLevel: "trusted",
      },
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
