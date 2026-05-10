import { describe, expect, it } from "vitest";
import {
  codexNotificationToEvents,
  codexServerRequestToEvent,
  threadStartResponseToEvent,
  turnStartResponseToEvent,
  threadReadResponseToEvents,
  threadListResponseToEvents,
  threadTurnsListResponseToEvents,
} from "../src/index.js";

describe("Codex app-server event normalization", () => {
  const projectId = "project_1" as never;

  it("normalizes thread, turn, assistant, and timeline notifications", () => {
    expect(
      codexNotificationToEvents(
        {
          method: "thread/started",
          params: { thread: { id: "thread_1", name: null, preview: "Hello" } },
        },
        projectId,
      ),
    ).toEqual([
      {
        type: "thread.started",
        thread: { id: "thread_1", projectId, title: "Hello" },
      },
    ]);

    expect(
      codexNotificationToEvents(
        {
          method: "turn/started",
          params: { threadId: "thread_1", turn: { id: "turn_1", status: "inProgress" } },
        },
        projectId,
      ),
    ).toEqual([
      {
        type: "turn.status.changed",
        threadId: "thread_1",
        turnId: "turn_1",
        status: "running",
      },
    ]);

    expect(
      codexNotificationToEvents(
        {
          method: "item/agentMessage/delta",
          params: { threadId: "thread_1", turnId: "turn_1", delta: "Hi" },
        },
        projectId,
      ),
    ).toEqual([
      { type: "assistant.delta", threadId: "thread_1", turnId: "turn_1", text: "Hi" },
    ]);

    expect(
      codexNotificationToEvents(
        {
          method: "item/started",
          params: {
            threadId: "thread_1",
            turnId: "turn_1",
            item: { id: "item_1", type: "commandExecution", command: "pwd" },
          },
        },
        projectId,
      ),
    ).toEqual([
      {
        type: "timeline.item.started",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "item_1",
        label: "pwd",
      },
    ]);

    expect(
      codexNotificationToEvents(
        {
          method: "item/fileChange/patchUpdated",
          params: {
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "item_file",
            changes: [
              { path: "README.md", kind: "update", diff: "@@\n+hello" },
            ],
          },
        },
        projectId,
      ),
    ).toEqual([
      {
        type: "timeline.item.started",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "item_file",
        label: "File change",
        detail: "update: README.md\n@@\n+hello",
      },
    ]);
  });

  it("records completed assistant messages as transcript and final response events", () => {
    expect(
      codexNotificationToEvents(
        {
          method: "item/completed",
          params: {
            threadId: "thread_1",
            turnId: "turn_1",
            item: { id: "item_1", type: "agentMessage", text: "Done" },
          },
        },
        projectId,
      ),
    ).toEqual([
      {
        type: "timeline.item.completed",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "item_1",
        status: "completed",
      },
      {
        type: "transcript.item.recorded",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "item_1",
        role: "assistant",
        text: "Done",
      },
      {
        type: "assistant.final",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "item_1",
        text: "Done",
      },
    ]);
  });

  it("projects context compaction as timeline activity instead of transcript text", () => {
    expect(
      codexNotificationToEvents(
        {
          method: "item/started",
          params: {
            threadId: "thread_1",
            turnId: "turn_1",
            item: { id: "item_compact", type: "context_compaction" },
          },
        },
        projectId,
      ),
    ).toEqual([
      {
        type: "timeline.item.started",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "item_compact",
        label: "Context compaction",
      },
    ]);
  });

  it("separates Codex diagnostics from normal transcript and timeline events", () => {
    expect(
      codexNotificationToEvents(
        {
          method: "warning",
          params: { message: "MCP server failed to start" },
        },
        projectId,
      ),
    ).toEqual([
      {
        type: "diagnostic.reported",
        diagnostic: {
          scope: "codex",
          severity: "warning",
          message: "MCP server failed to start",
        },
      },
    ]);

    expect(
      codexNotificationToEvents(
        {
          method: "deprecationNotice",
          params: { message: "old method" },
        },
        projectId,
      ),
    ).toEqual([
      {
        type: "diagnostic.reported",
        diagnostic: {
          scope: "codex",
          severity: "info",
          message: "old method",
        },
      },
    ]);
  });

  it("normalizes app-server responses into Codex Link events", () => {
    expect(
      threadStartResponseToEvent(
        { thread: { id: "thread_1", name: "Thread title", preview: "Preview" } },
        projectId,
      ),
    ).toEqual({
      type: "thread.started",
      thread: { id: "thread_1", projectId, title: "Thread title" },
    });
    expect(
      turnStartResponseToEvent(
        { turn: { id: "turn_1", status: "inProgress" } },
        "thread_1" as never,
      ),
    ).toEqual({
      type: "turn.status.changed",
      threadId: "thread_1",
      turnId: "turn_1",
      status: "running",
    });
  });

  it("projects thread read/list/turns responses into restore events", () => {
    const thread = {
      id: "thread_1",
      name: null,
      preview: "Preview",
      turns: [
        {
          id: "turn_1",
          status: "completed",
          items: [
            {
              id: "item_user",
              type: "userMessage",
              content: [{ type: "text", text: "Hello", text_elements: [] }],
            },
            { id: "item_agent", type: "agentMessage", text: "Hi", phase: null },
          ],
        },
      ],
    };

    expect(threadReadResponseToEvents({ thread }, projectId)).toMatchObject([
      { type: "thread.started", thread: { id: "thread_1", projectId, title: "Preview" } },
      {
        type: "turn.status.changed",
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
      },
      { type: "timeline.item.started", itemId: "item_user" },
      { type: "timeline.item.completed", itemId: "item_user" },
      { type: "transcript.item.recorded", itemId: "item_user", role: "user", text: "Hello" },
      { type: "timeline.item.started", itemId: "item_agent" },
      { type: "timeline.item.completed", itemId: "item_agent" },
      { type: "transcript.item.recorded", itemId: "item_agent", role: "assistant", text: "Hi" },
      { type: "assistant.final", itemId: "item_agent", text: "Hi" },
    ]);

    expect(threadListResponseToEvents({ data: [thread] }, projectId)).toEqual([
      { type: "thread.started", thread: { id: "thread_1", projectId, title: "Preview" } },
    ]);

    expect(
      threadTurnsListResponseToEvents({ data: thread.turns }, projectId, "thread_1" as never),
    ).toContainEqual({
      type: "turn.status.changed",
      threadId: "thread_1",
      turnId: "turn_1",
      status: "completed",
    });
  });

  it("normalizes command, network, file-change, and user-input approval requests", () => {
    expect(
      codexServerRequestToEvent({
        id: "approval_1",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_1",
          command: "npm test",
          cwd: "/repo",
          availableDecisions: ["accept", "acceptForSession", "decline"],
        },
      }),
    ).toMatchObject({
      type: "approval.requested",
      request: {
        id: "approval_1",
        kind: "command_execution",
        detail: "npm test\ncwd: /repo",
        availableDecisions: ["accept", "accept_for_session", "decline"],
      },
    });

    expect(
      codexServerRequestToEvent({
        id: "approval_2",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_1",
          networkApprovalContext: { host: "example.com" },
        },
      }),
    ).toMatchObject({
      request: {
        kind: "network",
        detail: "network: example.com",
      },
    });

    expect(
      codexServerRequestToEvent({
        id: "approval_3",
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_2",
          grantRoot: "/repo/tmp",
          reason: "Need to write generated output",
        },
      }),
    ).toMatchObject({
      request: {
        kind: "file_change",
        detail: "grant root: /repo/tmp\nNeed to write generated output",
      },
    });

    expect(
      codexServerRequestToEvent({
        id: "approval_5",
        method: "item/permissions/requestApproval",
        params: {
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_4",
          cwd: "/repo",
          reason: "Need broader project access",
          permissions: {
            network: { enabled: true },
            fileSystem: {
              read: ["/repo/docs"],
              write: ["/repo/tmp"],
              entries: [
                { access: "write", path: { type: "glob_pattern", pattern: "/repo/*.md" } },
              ],
            },
          },
        },
      }),
    ).toMatchObject({
      request: {
        kind: "network",
        detail: [
          "cwd: /repo",
          "Need broader project access",
          "network permission: enabled",
          "read access: /repo/docs",
          "write access: /repo/tmp",
          "write access: glob:/repo/*.md",
        ].join("\n"),
      },
    });

    expect(
      codexServerRequestToEvent({
        id: "approval_4",
        method: "item/tool/requestUserInput",
        params: { threadId: "thread_1", turnId: "turn_1", itemId: "item_3", questions: [] },
      }),
    ).toMatchObject({ request: { kind: "user_input" } });
  });
});
