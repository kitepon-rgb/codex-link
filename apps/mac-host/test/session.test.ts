import type { CodexLinkEvent } from "@codex-link/protocol";
import type { CodexAppServerClient } from "@codex-link/codex-client";
import { describe, expect, it } from "vitest";
import { MacHostSessionRunner, type MacHostConfig } from "../src/index.js";
import type { VscodeIpcClient, VscodeIpcMessage } from "../src/vscode-ipc.js";

describe("MacHostSessionRunner", () => {
  const config = {
    relayUrl: "ws://127.0.0.1:3000",
    userId: "usr_1" as never,
    deviceId: "dev_1" as never,
    deviceToken: "device_token_1",
    hostId: "host_1" as never,
    hostName: "MacBook",
    projects: [{ id: "project_1" as never, name: "Codex Link", path: "/repo" }],
  } satisfies MacHostConfig;

  it("starts a thread and turn through codex app-server", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const events: CodexLinkEvent[] = [];
    const codex = fakeCodexClient(async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/start") {
        return { thread: { id: "thread_1", name: null, preview: "Prompt" } };
      }
      if (method === "turn/start") {
        return { turn: { id: "turn_1", status: "inProgress" } };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const runner = new MacHostSessionRunner({
      config,
      codex,
      relay: { sendHostEvent: (event) => events.push(event) },
    });

    await runner.handleCommand({
      type: "codex.turn.start",
      projectId: "project_1",
      prompt: "Prompt",
    });

    expect(requests).toEqual([
      {
        method: "thread/start",
        params: {
          cwd: "/repo",
          serviceName: "codex-link-mac-host",
          approvalsReviewer: "user",
          experimentalRawEvents: true,
          persistExtendedHistory: false,
        },
      },
      {
        method: "turn/start",
        params: {
          threadId: "thread_1",
          input: [{ type: "text", text: "Prompt", text_elements: [] }],
          cwd: "/repo",
        },
      },
    ]);
    expect(events).toEqual([
      {
        type: "thread.started",
        thread: { id: "thread_1", projectId: "project_1", title: "Prompt", updatedAt: null },
      },
      {
        type: "turn.status.changed",
        threadId: "thread_1",
        turnId: "turn_1",
        status: "running",
      },
    ]);
  });

  it("forwards approvalPolicy / sandbox / cwd overrides into thread start when creating a new thread", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const codex = fakeCodexClient(async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/start") {
        return { thread: { id: "thread_2", name: null, preview: "P" } };
      }
      if (method === "turn/start") {
        return { turn: { id: "turn_2", status: "inProgress" } };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const runner = new MacHostSessionRunner({
      config,
      codex,
      relay: { sendHostEvent: () => undefined },
    });

    await runner.handleCommand({
      type: "codex.turn.start",
      projectId: "project_1",
      prompt: "Write file",
      cwd: "/tmp/codex-link-approval",
      approvalPolicy: "on-request",
      sandbox: "read-only",
    });

    const threadStart = requests.find((entry) => entry.method === "thread/start");
    expect(threadStart?.params).toEqual({
      cwd: "/tmp/codex-link-approval",
      serviceName: "codex-link-mac-host",
      approvalsReviewer: "user",
      experimentalRawEvents: true,
      persistExtendedHistory: false,
      approvalPolicy: "on-request",
      sandbox: "read-only",
    });
    const turnStart = requests.find((entry) => entry.method === "turn/start");
    expect(turnStart?.params).toEqual({
      threadId: "thread_2",
      input: [{ type: "text", text: "Write file", text_elements: [] }],
      cwd: "/tmp/codex-link-approval",
    });
  });

  it("steers and interrupts active turns through codex app-server", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const codex = fakeCodexClient(async (method, params) => {
      requests.push({ method, params });
      return {};
    });
    const runner = new MacHostSessionRunner({
      config,
      codex,
      relay: { sendHostEvent: () => undefined },
    });

    await runner.handleCommand({
      type: "codex.turn.steer",
      threadId: "thread_1",
      turnId: "turn_1",
      prompt: "追加指示",
    });
    await runner.handleCommand({
      type: "codex.turn.interrupt",
      threadId: "thread_1",
      turnId: "turn_1",
    });

    expect(requests).toEqual([
      {
        method: "turn/steer",
        params: {
          threadId: "thread_1",
          expectedTurnId: "turn_1",
          input: [{ type: "text", text: "追加指示", text_elements: [] }],
        },
      },
      {
        method: "turn/interrupt",
        params: { threadId: "thread_1", turnId: "turn_1" },
      },
    ]);
  });

  it("resolves approval requests through codex app-server and emits resolved event after server confirmation", async () => {
    const responses: Array<{ id: string; result: unknown }> = [];
    const events: CodexLinkEvent[] = [];
    const codex = fakeCodexClient(async () => ({}), (id, result) => {
      responses.push({ id: String(id), result });
    });
    const runner = new MacHostSessionRunner({
      config,
      codex,
      relay: { sendHostEvent: (event) => events.push(event) },
    });

    await runner.handleCommand({
      type: "codex.approval.resolve",
      requestId: "approval_1",
      decision: "accept_for_session",
    });
    runner.handleCodexNotification({
      method: "serverRequest/resolved",
      params: { threadId: "thread_1", requestId: "approval_1" },
    });

    expect(responses).toEqual([
      { id: "approval_1", result: { decision: "acceptForSession" } },
    ]);
    expect(events).toEqual([
      {
        type: "approval.resolved",
        requestId: "approval_1",
        decision: "accept_for_session",
      },
    ]);
  });

  it("clears approval requests when app-server resolves them without a local decision", () => {
    const events: CodexLinkEvent[] = [];
    const codex = fakeCodexClient(async () => ({}));
    const runner = new MacHostSessionRunner({
      config,
      codex,
      relay: { sendHostEvent: (event) => events.push(event) },
    });

    runner.handleCodexServerRequest({
      id: "approval_1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "item_1",
        command: "pnpm test",
        cwd: "/repo",
        availableDecisions: ["accept", "decline"],
      },
    });
    runner.handleCodexNotification({
      method: "serverRequest/resolved",
      params: { threadId: "thread_1", requestId: "approval_1" },
    });

    expect(events).toEqual([
      {
        type: "approval.requested",
        request: {
          id: "approval_1",
          kind: "command_execution",
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_1",
          title: "Command approval",
          detail: "pnpm test\ncwd: /repo",
          availableDecisions: ["accept", "decline"],
        },
      },
      {
        type: "approval.resolved",
        requestId: "approval_1",
      },
    ]);
  });

  it("ingests VS Code-originated turns from IPC broadcasts as assistant.delta and final transcript.item.recorded, ignores baseline history, and dedups against loopback-known turnIds", async () => {
    const events: CodexLinkEvent[] = [];
    const codex = fakeCodexClient(async () => ({}));
    const vscodeIpc = fakeVscodeIpcClient();
    const runner = new MacHostSessionRunner({
      config,
      codex,
      relay: { sendHostEvent: (event) => events.push(event) },
      vscodeIpc,
    });

    // Snapshot: existing turn_history is baseline (must not be replayed).
    vscodeIpc.emit({
      type: "broadcast",
      method: "thread-stream-state-changed",
      params: {
        conversationId: "thread_vs",
        hostId: "local",
        change: {
          type: "snapshot",
          conversationState: {
            turns: [{ turnId: "turn_history", status: "completed", items: [] }],
          },
        },
      },
    });
    expect(events).toEqual([]);

    // Patches: a NEW turn appears, with growing agent text.
    vscodeIpc.emit({
      type: "broadcast",
      method: "thread-stream-state-changed",
      params: {
        conversationId: "thread_vs",
        hostId: "local",
        change: {
          type: "patches",
          patches: [
            {
              op: "add",
              path: "/turns/-",
              value: {
                turnId: "turn_vs",
                status: "inProgress",
                params: { input: [{ type: "text", text: "Hello" }] },
                items: [{ type: "agentMessage", text: "Hi" }],
              },
            },
          ],
        },
      },
    });

    // Agent text grows; delta should only include the new suffix.
    vscodeIpc.emit({
      type: "broadcast",
      method: "thread-stream-state-changed",
      params: {
        conversationId: "thread_vs",
        hostId: "local",
        change: {
          type: "patches",
          patches: [{ op: "replace", path: "/turns/1/items/0/text", value: "Hi there" }],
        },
      },
    });

    // Status flips to completed.
    vscodeIpc.emit({
      type: "broadcast",
      method: "thread-stream-state-changed",
      params: {
        conversationId: "thread_vs",
        hostId: "local",
        change: {
          type: "patches",
          patches: [{ op: "replace", path: "/turns/1/status", value: "completed" }],
        },
      },
    });

    expect(events).toEqual([
      {
        type: "turn.status.changed",
        threadId: "thread_vs",
        turnId: "turn_vs",
        status: "running",
      },
      {
        type: "transcript.item.recorded",
        threadId: "thread_vs",
        turnId: "turn_vs",
        itemId: "turn_vs-user-0",
        role: "user",
        text: "Hello",
      },
      { type: "assistant.delta", threadId: "thread_vs", turnId: "turn_vs", text: "Hi" },
      { type: "assistant.delta", threadId: "thread_vs", turnId: "turn_vs", text: " there" },
      {
        type: "turn.status.changed",
        threadId: "thread_vs",
        turnId: "turn_vs",
        status: "completed",
      },
      {
        type: "transcript.item.recorded",
        threadId: "thread_vs",
        turnId: "turn_vs",
        itemId: "turn_vs-agent-0",
        role: "assistant",
        text: "Hi there",
      },
    ]);

    // Loopback-known turn must be dropped from broadcast (no duplicate).
    events.length = 0;
    runner.handleCodexNotification({
      method: "turn/started",
      params: { threadId: "thread_vs", turn: { id: "turn_loopback" } },
    });
    // Drain the codex-events output emitted by the notification.
    events.length = 0;
    vscodeIpc.emit({
      type: "broadcast",
      method: "thread-stream-state-changed",
      params: {
        conversationId: "thread_vs",
        hostId: "local",
        change: {
          type: "patches",
          patches: [
            {
              op: "add",
              path: "/turns/-",
              value: {
                turnId: "turn_loopback",
                status: "inProgress",
                params: { input: [{ type: "text", text: "from loopback" }] },
                items: [{ type: "agentMessage", text: "echo" }],
              },
            },
          ],
        },
      },
    });
    expect(events).toEqual([]);
  });

  it("restores thread, lists threads, and lists turn items through codex app-server", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const events: CodexLinkEvent[] = [];
    const codex = fakeCodexClient(async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/list") {
        return { data: [{ id: "thread_1", name: null, preview: "Preview" }] };
      }
      if (method === "thread/read") {
        return {
          thread: {
            id: "thread_1",
            name: null,
            preview: "Preview",
            turns: [{ id: "turn_1", status: "completed", items: [] }],
          },
        };
      }
      if (method === "thread/turns/list") {
        return { data: [{ id: "turn_1", status: "completed", items: [] }] };
      }
      return {};
    });
    const runner = new MacHostSessionRunner({
      config,
      codex,
      relay: { sendHostEvent: (event) => events.push(event) },
    });

    await runner.handleCommand({ type: "codex.thread.list", projectId: "project_1", limit: 25 });
    await runner.handleCommand({
      type: "codex.thread.restore",
      projectId: "project_1",
      threadId: "thread_1",
    });
    await runner.handleCommand({
      type: "codex.thread.turns.list",
      projectId: "project_1",
      threadId: "thread_1",
      limit: 10,
    });

    expect(requests).toEqual([
      {
        method: "thread/list",
        params: {
          limit: 25,
          cwd: "/repo",
          sourceKinds: ["cli", "vscode", "exec", "appServer"],
        },
      },
      { method: "thread/read", params: { threadId: "thread_1", includeTurns: true } },
      {
        method: "thread/turns/list",
        params: {
          threadId: "thread_1",
          limit: 10,
          sortDirection: "asc",
          itemsView: "full",
        },
      },
    ]);
    expect(events).toContainEqual({
      type: "thread.started",
      thread: { id: "thread_1", projectId: "project_1", title: "Preview", updatedAt: null },
    });
    expect(events).toContainEqual({
      type: "turn.status.changed",
      threadId: "thread_1",
      turnId: "turn_1",
      status: "completed",
    });
  });
});

function fakeCodexClient(
  requestHandler: (method: string, params?: unknown) => Promise<unknown>,
  responseHandler: (id: string | number, result: unknown) => void = () => undefined,
): CodexAppServerClient {
  return {
    start: async () => undefined,
    initialize: async () => ({}),
    request: requestHandler,
    startThread: (params) => requestHandler("thread/start", params),
    resumeThread: (params) => requestHandler("thread/resume", params),
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
    respondToServerRequest: responseHandler,
    notify: () => undefined,
    close: async () => undefined,
  };
}

interface FakeVscodeIpcClient extends VscodeIpcClient {
  emit(message: VscodeIpcMessage): void;
}

function fakeVscodeIpcClient(): FakeVscodeIpcClient {
  const listeners = new Set<(message: VscodeIpcMessage) => void>();
  const stub = {
    isOpen: true,
    onMessage(listener: (message: VscodeIpcMessage) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(message: VscodeIpcMessage): void {
      for (const listener of listeners) listener(message);
    },
    request: async () => ({ resultType: "success" as const, result: undefined, error: undefined }),
    close: () => undefined,
    open: async () => undefined,
  };
  return stub as unknown as FakeVscodeIpcClient;
}
