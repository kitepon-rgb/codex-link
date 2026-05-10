import type {
  ApprovalDecisionKind,
  ApprovalKind,
  CodexLinkEvent,
  ItemId,
  ProjectId,
  RequestId,
  ThreadId,
  TurnId,
  TurnStatus,
} from "@codex-link/protocol";
import type { JsonRpcNotification, JsonRpcServerRequest } from "@codex-link/codex-client";

export function codexNotificationToEvents(
  message: JsonRpcNotification,
  projectId: ProjectId,
): CodexLinkEvent[] {
  const params = objectValue(message.params);
  if (!params) {
    return [];
  }

  if (message.method === "thread/started") {
    const thread = objectValue(params.thread);
    const threadId = stringValue(thread?.id);
    if (!threadId) {
      return [];
    }
    return [
      {
        type: "thread.started",
        thread: {
          id: threadId as ThreadId,
          projectId,
          title: stringValue(thread?.name) ?? stringValue(thread?.preview) ?? null,
        },
      },
    ];
  }

  if (message.method === "turn/started" || message.method === "turn/completed") {
    const turn = objectValue(params.turn);
    const turnId = stringValue(turn?.id);
    if (!turnId) {
      return [];
    }
    return [
      {
        type: "turn.status.changed",
        turnId: turnId as TurnId,
        status: codexTurnStatusToLinkStatus(stringValue(turn?.status)),
      },
    ];
  }

  if (message.method === "item/agentMessage/delta") {
    const threadId = stringValue(params.threadId);
    const turnId = stringValue(params.turnId);
    const text = stringValue(params.delta);
    if (!threadId || !turnId || !text) {
      return [];
    }
    return [
      {
        type: "assistant.delta",
        threadId: threadId as ThreadId,
        turnId: turnId as TurnId,
        text,
      },
    ];
  }

  if (message.method === "item/started") {
    const item = objectValue(params.item);
    const itemId = stringValue(item?.id);
    const threadId = stringValue(params.threadId);
    const turnId = stringValue(params.turnId);
    if (!itemId || !threadId || !turnId) {
      return [];
    }
    return [
      {
        type: "timeline.item.started",
        threadId: threadId as ThreadId,
        turnId: turnId as TurnId,
        itemId: itemId as ItemId,
        label: itemLabel(item),
      },
    ];
  }

  if (message.method === "item/completed") {
    const item = objectValue(params.item);
    const itemId = stringValue(item?.id);
    const threadId = stringValue(params.threadId);
    const turnId = stringValue(params.turnId);
    if (!itemId || !threadId || !turnId) {
      return [];
    }
    const events: CodexLinkEvent[] = [
      {
        type: "timeline.item.completed",
        threadId: threadId as ThreadId,
        turnId: turnId as TurnId,
        itemId: itemId as ItemId,
        status: itemCompletedStatus(item),
      },
    ];
    const transcriptEvent = itemToTranscriptEvent(item, threadId, turnId);
    if (transcriptEvent) {
      events.push(transcriptEvent);
    }
    const finalEvent = itemToFinalEvent(item, threadId, turnId);
    if (finalEvent) {
      events.push(finalEvent);
    }
    return events;
  }

  if (message.method === "error") {
    const messageText = stringValue(params.message) ?? JSON.stringify(params);
    return [{ type: "error.reported", scope: "codex", message: messageText }];
  }

  return [];
}

export function threadReadResponseToEvents(
  response: unknown,
  projectId: ProjectId,
): CodexLinkEvent[] {
  const thread = objectValue(objectValue(response)?.thread);
  return thread ? threadToEvents(thread, projectId) : [];
}

export function threadListResponseToEvents(
  response: unknown,
  projectId: ProjectId,
): CodexLinkEvent[] {
  const data = objectValue(response)?.data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data.flatMap((thread) => {
    const threadObject = objectValue(thread);
    return threadObject ? threadToStartedEvent(threadObject, projectId) : [];
  });
}

export function threadTurnsListResponseToEvents(
  response: unknown,
  projectId: ProjectId,
  threadId: ThreadId,
): CodexLinkEvent[] {
  const data = objectValue(response)?.data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data.flatMap((turn) => {
    const turnObject = objectValue(turn);
    return turnObject ? turnToEvents(turnObject, String(threadId), projectId) : [];
  });
}

export function codexServerRequestToEvent(
  message: JsonRpcServerRequest,
): CodexLinkEvent | null {
  const params = objectValue(message.params);
  if (!params) {
    return null;
  }

  if (message.method === "item/commandExecution/requestApproval") {
    const kind: ApprovalKind = objectValue(params.networkApprovalContext)
      ? "network"
      : "command_execution";
    return approvalEvent({
      id: String(message.id) as RequestId,
      kind,
      threadId: stringValue(params.threadId),
      turnId: stringValue(params.turnId),
      itemId: stringValue(params.itemId),
      title: kind === "network" ? "Network approval" : "Command approval",
      detail: commandApprovalDetail(params),
      availableDecisions: decisionsFromCodex(params.availableDecisions),
    });
  }

  if (message.method === "item/fileChange/requestApproval") {
    return approvalEvent({
      id: String(message.id) as RequestId,
      kind: "file_change",
      threadId: stringValue(params.threadId),
      turnId: stringValue(params.turnId),
      itemId: stringValue(params.itemId),
      title: "File change approval",
      detail: fileChangeApprovalDetail(params),
      availableDecisions: ["accept", "decline"],
    });
  }

  if (message.method === "item/permissions/requestApproval") {
    return approvalEvent({
      id: String(message.id) as RequestId,
      kind: objectValue(objectValue(params.permissions)?.network) ? "network" : "command_execution",
      threadId: stringValue(params.threadId),
      turnId: stringValue(params.turnId),
      itemId: stringValue(params.itemId),
      title: "Permission approval",
      detail: stringValue(params.reason) ?? `cwd: ${String(params.cwd ?? "")}`,
      availableDecisions: ["accept", "decline"],
    });
  }

  if (message.method === "item/tool/requestUserInput") {
    return approvalEvent({
      id: String(message.id) as RequestId,
      kind: "user_input",
      threadId: stringValue(params.threadId),
      turnId: stringValue(params.turnId),
      itemId: stringValue(params.itemId),
      title: "User input requested",
      detail: JSON.stringify(params.questions ?? []),
      availableDecisions: ["accept", "cancel"],
    });
  }

  return null;
}

function threadToEvents(thread: Record<string, unknown>, projectId: ProjectId): CodexLinkEvent[] {
  const threadId = stringValue(thread.id);
  if (!threadId) {
    return [];
  }
  const events: CodexLinkEvent[] = [threadToStartedEvent(thread, projectId)];
  const turns = thread.turns;
  if (Array.isArray(turns)) {
    for (const turn of turns) {
      const turnObject = objectValue(turn);
      if (turnObject) {
        events.push(...turnToEvents(turnObject, threadId, projectId));
      }
    }
  }
  return events;
}

function threadToStartedEvent(
  thread: Record<string, unknown>,
  projectId: ProjectId,
): CodexLinkEvent {
  const threadId = stringValue(thread.id);
  if (!threadId) {
    throw new Error("Codex thread object did not include id");
  }
  return {
    type: "thread.started",
    thread: {
      id: threadId as ThreadId,
      projectId,
      title: stringValue(thread.name) ?? stringValue(thread.preview) ?? null,
    },
  };
}

function turnToEvents(
  turn: Record<string, unknown>,
  threadId: string,
  _projectId: ProjectId,
): CodexLinkEvent[] {
  const turnId = stringValue(turn.id);
  if (!turnId) {
    return [];
  }
  const events: CodexLinkEvent[] = [
    {
      type: "turn.status.changed",
      turnId: turnId as TurnId,
      status: codexTurnStatusToLinkStatus(stringValue(turn.status)),
    },
  ];
  if (Array.isArray(turn.items)) {
    for (const item of turn.items) {
      const itemObject = objectValue(item);
      if (!itemObject) {
        continue;
      }
      events.push(...itemToTimelineProjectionEvents(itemObject, threadId, turnId));
      const transcriptEvent = itemToTranscriptEvent(itemObject, threadId, turnId);
      if (transcriptEvent) {
        events.push(transcriptEvent);
      }
      const finalEvent = itemToFinalEvent(itemObject, threadId, turnId);
      if (finalEvent) {
        events.push(finalEvent);
      }
    }
  }
  return events;
}

export function threadStartResponseToEvent(
  response: unknown,
  projectId: ProjectId,
): CodexLinkEvent | null {
  const thread = objectValue(objectValue(response)?.thread);
  const threadId = stringValue(thread?.id);
  if (!thread || !threadId) {
    return null;
  }
  return {
    type: "thread.started",
    thread: {
      id: threadId as ThreadId,
      projectId,
      title: stringValue(thread.name) ?? stringValue(thread.preview) ?? null,
    },
  };
}

export function turnStartResponseToEvent(response: unknown): CodexLinkEvent | null {
  const turn = objectValue(objectValue(response)?.turn);
  const turnId = stringValue(turn?.id);
  if (!turn || !turnId) {
    return null;
  }
  return {
    type: "turn.status.changed",
    turnId: turnId as TurnId,
    status: codexTurnStatusToLinkStatus(stringValue(turn.status)),
  };
}

function approvalEvent(input: {
  id: RequestId;
  kind: ApprovalKind;
  threadId: string | undefined;
  turnId: string | undefined;
  itemId: string | undefined;
  title: string;
  detail: string;
  availableDecisions: ApprovalDecisionKind[];
}): CodexLinkEvent | null {
  if (!input.threadId || !input.turnId) {
    return null;
  }
  const request = {
    id: input.id,
    kind: input.kind,
    threadId: input.threadId as ThreadId,
    turnId: input.turnId as TurnId,
    title: input.title,
    detail: input.detail,
    availableDecisions: input.availableDecisions,
  };
  const requestWithOptionalItem = input.itemId
    ? { ...request, itemId: input.itemId as ItemId }
    : request;
  return {
    type: "approval.requested",
    request: requestWithOptionalItem,
  };
}

function codexTurnStatusToLinkStatus(status: string | undefined): TurnStatus {
  if (status === "completed") {
    return "completed";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "interrupted") {
    return "canceled";
  }
  return "running";
}

function itemCompletedStatus(item: Record<string, unknown> | null): "completed" | "failed" | "declined" {
  const status = stringValue(item?.status);
  if (status === "failed") {
    return "failed";
  }
  if (status === "declined") {
    return "declined";
  }
  return "completed";
}

function itemToTimelineProjectionEvents(
  item: Record<string, unknown>,
  threadId: string,
  turnId: string,
): CodexLinkEvent[] {
  const itemId = stringValue(item.id);
  if (!itemId) {
    return [];
  }
  return [
    {
      type: "timeline.item.started",
      threadId: threadId as ThreadId,
      turnId: turnId as TurnId,
      itemId: itemId as ItemId,
      label: itemLabel(item),
    },
    {
      type: "timeline.item.completed",
      threadId: threadId as ThreadId,
      turnId: turnId as TurnId,
      itemId: itemId as ItemId,
      status: itemCompletedStatus(item),
    },
  ];
}

function itemToTranscriptEvent(
  item: Record<string, unknown> | null,
  threadId: string,
  turnId: string,
): CodexLinkEvent | null {
  const itemId = stringValue(item?.id);
  const type = stringValue(item?.type);
  if (!itemId || !type) {
    return null;
  }
  if (type === "agentMessage") {
    const text = stringValue(item?.text);
    return text
      ? {
          type: "transcript.item.recorded",
          threadId: threadId as ThreadId,
          turnId: turnId as TurnId,
          itemId: itemId as ItemId,
          role: "assistant",
          text,
        }
      : null;
  }
  if (type === "userMessage" && item) {
    const text = userMessageText(item);
    return text
      ? {
          type: "transcript.item.recorded",
          threadId: threadId as ThreadId,
          turnId: turnId as TurnId,
          itemId: itemId as ItemId,
          role: "user",
          text,
        }
      : null;
  }
  return null;
}

function itemToFinalEvent(
  item: Record<string, unknown> | null,
  threadId: string,
  turnId: string,
): CodexLinkEvent | null {
  const itemId = stringValue(item?.id);
  const type = stringValue(item?.type);
  const text = stringValue(item?.text);
  if (type !== "agentMessage" || !itemId || !text) {
    return null;
  }
  return {
    type: "assistant.final",
    threadId: threadId as ThreadId,
    turnId: turnId as TurnId,
    itemId: itemId as ItemId,
    text,
  };
}

function userMessageText(item: Record<string, unknown>): string | null {
  const content = item.content;
  if (!Array.isArray(content)) {
    return null;
  }
  const text = content
    .map((part) => {
      const object = objectValue(part);
      return object && stringValue(object.type) === "text" ? stringValue(object.text) : undefined;
    })
    .filter((part): part is string => Boolean(part))
    .join("\n");
  return text || null;
}

function itemLabel(item: Record<string, unknown> | null): string {
  const type = stringValue(item?.type);
  if (type === "commandExecution") {
    return stringValue(item?.command) ?? "Command";
  }
  if (type === "fileChange") {
    return "File change";
  }
  if (type === "mcpToolCall") {
    const server = stringValue(item?.server);
    const tool = stringValue(item?.tool);
    return [server, tool].filter(Boolean).join(".") || "MCP tool";
  }
  if (type === "agentMessage") {
    return "Assistant message";
  }
  if (type === "reasoning") {
    return "Reasoning";
  }
  return type ?? "Timeline item";
}

function commandApprovalDetail(params: Record<string, unknown>): string {
  const parts = [
    stringValue(params.command),
    stringValue(params.cwd) ? `cwd: ${stringValue(params.cwd)}` : null,
    stringValue(params.reason),
  ].filter(Boolean);
  return parts.join("\n");
}

function fileChangeApprovalDetail(params: Record<string, unknown>): string {
  const parts = [
    stringValue(params.grantRoot) ? `grantRoot: ${stringValue(params.grantRoot)}` : null,
    stringValue(params.reason),
  ].filter(Boolean);
  return parts.join("\n") || "File change requires approval";
}

function decisionsFromCodex(value: unknown): ApprovalDecisionKind[] {
  if (!Array.isArray(value)) {
    return ["accept", "decline"];
  }
  const decisions = value
    .map((decision) => {
      if (decision === "accept") {
        return "accept";
      }
      if (decision === "acceptForSession") {
        return "accept_for_session";
      }
      if (decision === "decline") {
        return "decline";
      }
      if (decision === "cancel") {
        return "cancel";
      }
      if (typeof decision === "object" && decision) {
        return "accept_for_session";
      }
      return null;
    })
    .filter((decision): decision is ApprovalDecisionKind => decision !== null);
  return decisions.length > 0 ? [...new Set(decisions)] : ["accept", "decline"];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
