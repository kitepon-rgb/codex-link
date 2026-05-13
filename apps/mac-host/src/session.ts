import type {
  ApprovalDecisionKind,
  CodexLinkEvent,
  ItemId,
  ProjectId,
  RequestId,
  ThreadId,
  TurnId,
} from "@codex-link/protocol";
import type { CodexAppServerClient } from "@codex-link/codex-client";
import type { MacHostConfig, MacHostProjectConfig } from "./config.js";
import type { MacHostRelayClient } from "./relay-client.js";
import {
  codexNotificationToEvents,
  codexServerRequestToEvent,
  threadListResponseToEvents,
  threadStartResponseToEvent,
  threadReadResponseToEvents,
  threadTurnsListResponseToEvents,
  turnStartResponseToEvent,
} from "./codex-events.js";
import type { VscodeIpcClient, VscodeIpcMessage } from "./vscode-ipc.js";

export interface StartCodexTurnCommand {
  type: "codex.turn.start";
  projectId: ProjectId;
  prompt: string;
  threadId?: ThreadId;
  cwd?: string;
  approvalPolicy?: unknown;
  sandbox?: unknown;
}

export interface SteerCodexTurnCommand {
  type: "codex.turn.steer";
  threadId: ThreadId;
  turnId: string;
  prompt: string;
}

export interface InterruptCodexTurnCommand {
  type: "codex.turn.interrupt";
  threadId: ThreadId;
  turnId: string;
}

export interface RestoreCodexThreadCommand {
  type: "codex.thread.restore";
  projectId: ProjectId;
  threadId: ThreadId;
}

export interface ResolveCodexApprovalCommand {
  type: "codex.approval.resolve";
  requestId: RequestId;
  decision: ApprovalDecisionKind;
}

export interface ListCodexThreadsCommand {
  type: "codex.thread.list";
  projectId: ProjectId;
  limit?: number;
}

export interface ListCodexThreadTurnsCommand {
  type: "codex.thread.turns.list";
  projectId: ProjectId;
  threadId: ThreadId;
  limit?: number;
}

export type MacHostCommand =
  | StartCodexTurnCommand
  | SteerCodexTurnCommand
  | InterruptCodexTurnCommand
  | ResolveCodexApprovalCommand
  | RestoreCodexThreadCommand
  | ListCodexThreadsCommand
  | ListCodexThreadTurnsCommand;

export interface MacHostSessionRunnerOptions {
  config: MacHostConfig;
  codex: CodexAppServerClient;
  relay: Pick<MacHostRelayClient, "sendHostEvent">;
  vscodeIpc?: VscodeIpcClient | null;
}

export class MacHostSessionRunner {
  private readonly pendingApprovalRequestIds = new Set<string>();
  private readonly pendingApprovalDecisions = new Map<string, ApprovalDecisionKind>();
  private readonly activeTurnByThread = new Map<string, string>();
  private readonly originalRequestIds = new Map<string, string | number>();
  private readonly vscodeConversations = new Map<string, Record<string, unknown>>();
  private readonly vscodeSentSignatures = new Map<string, Set<string>>();

  constructor(private readonly options: MacHostSessionRunnerOptions) {
    if (options.vscodeIpc) {
      this.attachVscodeIpc(options.vscodeIpc);
    }
  }

  replaceVscodeIpc(client: VscodeIpcClient | null): void {
    this.options.vscodeIpc = client;
    this.vscodeConversations.clear();
    this.vscodeSentSignatures.clear();
    if (client) {
      this.attachVscodeIpc(client);
    }
  }

  private attachVscodeIpc(client: VscodeIpcClient): void {
    client.onMessage((message) => {
      try {
        this.handleVscodeIpcMessage(message);
      } catch (error) {
        console.error(
          `[mac-host] vscode-ipc broadcast handling failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  private handleVscodeIpcMessage(message: VscodeIpcMessage): void {
    if (message.type !== "broadcast" || message.method !== "thread-stream-state-changed") {
      return;
    }
    const params = (message.params ?? {}) as {
      conversationId?: string;
      hostId?: string;
      change?: { type?: string; conversationState?: Record<string, unknown>; patches?: Array<Record<string, unknown>> };
    };
    const conversationId = params.conversationId;
    if (!conversationId || params.hostId !== "local") {
      return;
    }
    const change = params.change;
    if (!change) {
      return;
    }
    let conversation = this.vscodeConversations.get(conversationId);
    if (change.type === "snapshot" && change.conversationState) {
      conversation = structuredClone(change.conversationState);
      this.vscodeConversations.set(conversationId, conversation);
    } else if (change.type === "patches" && conversation && Array.isArray(change.patches)) {
      applyVscodePatches(conversation, change.patches);
    } else {
      return;
    }
    this.emitCodexLinkEventsFromVscodeConversation(conversationId, conversation);
  }

  private emitCodexLinkEventsFromVscodeConversation(
    threadId: string,
    conversation: Record<string, unknown> | undefined,
  ): void {
    if (!conversation) return;
    const turns = (conversation as { turns?: unknown }).turns;
    if (!Array.isArray(turns)) return;
    let sent = this.vscodeSentSignatures.get(threadId);
    if (!sent) {
      sent = new Set<string>();
      this.vscodeSentSignatures.set(threadId, sent);
    }
    for (const rawTurn of turns) {
      const turn = (rawTurn ?? {}) as {
        turnId?: string;
        status?: string;
        params?: { input?: Array<{ type?: string; text?: string }> };
        items?: Array<{ type?: string; text?: string }>;
      };
      const turnId = typeof turn.turnId === "string" ? turn.turnId : null;
      if (!turnId) continue;
      const status =
        turn.status === "inProgress"
          ? "running"
          : turn.status === "failed"
            ? "failed"
            : turn.status === "completed"
              ? "completed"
              : null;
      if (status) {
        const key = `${turnId}|status|${status}`;
        if (!sent.has(key)) {
          sent.add(key);
          this.sendMaybe({
            type: "turn.status.changed",
            threadId: threadId as ThreadId,
            turnId: turnId as TurnId,
            status: status as "running" | "completed" | "failed",
          });
          if (status === "running") {
            this.activeTurnByThread.set(threadId, turnId);
          }
        }
      }
      const userTexts = Array.isArray(turn.params?.input)
        ? turn.params!.input
            .filter((piece) => piece?.type === "text" && typeof piece.text === "string")
            .map((piece) => piece.text!)
        : [];
      const userText = userTexts.join("");
      if (userText) {
        const key = `${turnId}|user|${userText}`;
        if (!sent.has(key)) {
          sent.add(key);
          this.sendMaybe({
            type: "transcript.item.recorded",
            threadId: threadId as ThreadId,
            turnId: turnId as TurnId,
            itemId: `${turnId}-user-0` as ItemId,
            role: "user",
            text: userText,
          });
        }
      }
      const items = Array.isArray(turn.items) ? turn.items : [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item?.type === "agentMessage" && typeof item.text === "string" && item.text.length > 0) {
          const key = `${turnId}|agent|${i}|${item.text.length}|${item.text.slice(-32)}`;
          if (!sent.has(key)) {
            sent.add(key);
            this.sendMaybe({
              type: "transcript.item.recorded",
              threadId: threadId as ThreadId,
              turnId: turnId as TurnId,
              itemId: `${turnId}-agent-${i}` as ItemId,
              role: "assistant",
              text: item.text,
            });
          }
        }
      }
    }
  }

  async handleCommand(command: unknown): Promise<void> {
    if (isStartCodexTurnCommand(command)) {
      await this.startTurn(command);
      return;
    }
    if (isSteerCodexTurnCommand(command)) {
      await this.steerTurn(command);
      return;
    }
    if (isInterruptCodexTurnCommand(command)) {
      await this.interruptTurn(command);
      return;
    }
    if (isResolveCodexApprovalCommand(command)) {
      this.resolveApproval(command);
      return;
    }
    if (isRestoreCodexThreadCommand(command)) {
      await this.restoreThread(command);
      return;
    }
    if (isListCodexThreadsCommand(command)) {
      await this.listThreads(command);
      return;
    }
    if (isListCodexThreadTurnsCommand(command)) {
      await this.listThreadTurns(command);
      return;
    }
    throw new Error("Unsupported Mac Host command");
  }

  async startTurn(command: StartCodexTurnCommand): Promise<void> {
    const project = this.projectFor(command.projectId);
    const cwd = command.cwd ?? project.path;

    if (command.threadId && this.options.vscodeIpc?.isOpen) {
      try {
        const turnStartParams: Record<string, unknown> = {
          cwd,
          input: [{ type: "text", text: command.prompt, text_elements: [] }],
        };
        const response = await this.options.vscodeIpc.request(
          "thread-follower-start-turn",
          { conversationId: command.threadId, turnStartParams },
          { version: 1, timeoutMs: 15000 },
        );
        if (response.resultType !== "success") {
          throw new Error(response.error ?? "vscode_ipc_start_turn_failed");
        }
        const turnIdValue = (response.result as { turn?: { id?: string } } | undefined)?.turn?.id;
        if (turnIdValue) {
          this.activeTurnByThread.set(command.threadId, turnIdValue);
          this.sendMaybe({
            type: "turn.status.changed",
            threadId: command.threadId as ThreadId,
            turnId: turnIdValue as TurnId,
            status: "running",
          });
        }
        return;
      } catch (error) {
        console.error(
          `[mac-host] VS Code IPC start-turn failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    }

    const threadOverrides: { cwd?: string; approvalPolicy?: unknown; sandbox?: unknown } = {};
    if (command.cwd !== undefined) threadOverrides.cwd = command.cwd;
    if (command.approvalPolicy !== undefined) threadOverrides.approvalPolicy = command.approvalPolicy;
    if (command.sandbox !== undefined) threadOverrides.sandbox = command.sandbox;
    let threadId: ThreadId;
    if (command.threadId) {
      threadId = command.threadId;
      try {
        await this.options.codex.resumeThread({ threadId, cwd });
      } catch (error) {
        console.error(`[mac-host] thread/resume failed for ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    } else {
      threadId = await this.startThread(project, threadOverrides);
    }
    const turnParams: Record<string, unknown> = {
      threadId,
      input: [{ type: "text", text: command.prompt, text_elements: [] }],
      cwd,
    };
    const turnResponse = await this.options.codex.startTurn(turnParams);
    const turnEvent = turnStartResponseToEvent(turnResponse, threadId);
    if (turnEvent && turnEvent.type === "turn.status.changed") {
      this.activeTurnByThread.set(turnEvent.threadId, turnEvent.turnId);
    }
    this.sendMaybe(turnEvent);
  }

  async steerTurn(command: SteerCodexTurnCommand): Promise<void> {
    await this.options.codex.steerTurn({
      threadId: command.threadId,
      expectedTurnId: command.turnId,
      input: [{ type: "text", text: command.prompt, text_elements: [] }],
    });
  }

  async interruptTurn(command: InterruptCodexTurnCommand): Promise<void> {
    await this.options.codex.interruptTurn({
      threadId: command.threadId,
      turnId: command.turnId,
    });
  }

  resolveApproval(command: ResolveCodexApprovalCommand): void {
    const originalId = this.originalRequestIds.get(command.requestId) ?? command.requestId;
    this.options.codex.respondToServerRequest(originalId, {
      decision: decisionToCodex(command.decision),
    });
    this.pendingApprovalDecisions.set(command.requestId, command.decision);
    this.originalRequestIds.delete(command.requestId);
  }

  async restoreThread(command: RestoreCodexThreadCommand): Promise<void> {
    this.projectFor(command.projectId);
    const response = await this.options.codex.readThread({
      threadId: command.threadId,
      includeTurns: true,
    });
    for (const event of threadReadResponseToEvents(response, command.projectId)) {
      this.send(event);
    }
  }

  async listThreads(command: ListCodexThreadsCommand): Promise<void> {
    const project = this.projectFor(command.projectId);
    const response = await this.options.codex.listThreads({
      limit: command.limit ?? 50,
      cwd: project.path,
      sourceKinds: ["cli", "vscode", "exec", "appServer"],
    });
    for (const event of threadListResponseToEvents(response, command.projectId)) {
      this.send(event);
    }
  }

  async listThreadTurns(command: ListCodexThreadTurnsCommand): Promise<void> {
    this.projectFor(command.projectId);
    const response = await this.options.codex.listThreadTurns({
      threadId: command.threadId,
      limit: command.limit ?? 100,
      sortDirection: "asc",
      itemsView: "full",
    });
    for (const event of threadTurnsListResponseToEvents(
      response,
      command.projectId,
      command.threadId,
    )) {
      this.send(event);
    }
  }

  handleCodexNotification(message: Parameters<typeof codexNotificationToEvents>[0]): void {
    this.captureActiveTurnFromNotification(message);
    if (message.method === "serverRequest/resolved") {
      const requestId = requestIdFromServerRequestResolved(message.params);
      const decision = requestId ? this.pendingApprovalDecisions.get(requestId) : undefined;
      const hadPendingRequest = requestId
        ? this.pendingApprovalRequestIds.delete(requestId)
        : false;
      if (requestId && (hadPendingRequest || decision)) {
        this.pendingApprovalDecisions.delete(requestId);
        const resolvedEvent: CodexLinkEvent = {
          type: "approval.resolved",
          requestId: requestId as RequestId,
          ...(decision ? { decision } : {}),
        };
        this.send(resolvedEvent);
      }
      return;
    }

    const projectId = this.options.config.projects[0]?.id;
    if (!projectId) {
      this.send({
        type: "error.reported",
        scope: "host",
        message: "Mac Host has no configured project for Codex notification mapping",
      });
      return;
    }
    for (const event of codexNotificationToEvents(message, projectId)) {
      this.send(event);
    }
  }

  handleCodexServerRequest(message: Parameters<typeof codexServerRequestToEvent>[0]): void {
    const event = codexServerRequestToEvent(message, {
      activeTurnIdForThread: (threadId) => this.activeTurnByThread.get(threadId),
    });
    if (event?.type === "approval.requested") {
      this.pendingApprovalRequestIds.add(event.request.id);
      if (typeof message.id === "number" || typeof message.id === "string") {
        this.originalRequestIds.set(event.request.id, message.id);
      }
    }
    if (!event && message.method) {
      this.send({
        type: "diagnostic.reported",
        diagnostic: {
          scope: "host",
          severity: "info",
          message: `Mac Host received unhandled server request: ${message.method}`,
        },
      });
    }
    this.sendMaybe(event);
  }

  private captureActiveTurnFromNotification(
    message: Parameters<typeof codexNotificationToEvents>[0],
  ): void {
    if (message.method !== "turn/started" && message.method !== "turn/completed") {
      return;
    }
    const params = message.params;
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      return;
    }
    const paramsObject = params as { threadId?: unknown; turn?: unknown };
    const turn = paramsObject.turn && typeof paramsObject.turn === "object" && !Array.isArray(paramsObject.turn)
      ? paramsObject.turn as { id?: unknown; threadId?: unknown }
      : null;
    const threadId = typeof paramsObject.threadId === "string"
      ? paramsObject.threadId
      : (turn && typeof turn.threadId === "string" ? turn.threadId : null);
    const turnId = turn && typeof turn.id === "string" ? turn.id : null;
    if (!threadId || !turnId) {
      return;
    }
    if (message.method === "turn/started") {
      this.activeTurnByThread.set(threadId, turnId);
    } else if (this.activeTurnByThread.get(threadId) === turnId) {
      this.activeTurnByThread.delete(threadId);
    }
  }

  private async startThread(
    project: MacHostProjectConfig,
    overrides: {
      cwd?: string;
      approvalPolicy?: unknown;
      sandbox?: unknown;
    } = {},
  ): Promise<ThreadId> {
    const threadParams: Record<string, unknown> = {
      cwd: overrides.cwd ?? project.path,
      serviceName: "codex-link-mac-host",
      approvalsReviewer: "user",
      experimentalRawEvents: true,
      persistExtendedHistory: false,
    };
    if (overrides.approvalPolicy !== undefined) {
      threadParams.approvalPolicy = overrides.approvalPolicy;
    }
    if (overrides.sandbox !== undefined) {
      threadParams.sandbox = overrides.sandbox;
    }
    const threadResponse = await this.options.codex.startThread(threadParams);
    this.sendMaybe(threadStartResponseToEvent(threadResponse, project.id));
    const threadId = threadIdFromResponse(threadResponse);
    if (!threadId) {
      throw new Error("Codex app-server thread/start response did not include thread.id");
    }
    return threadId;
  }

  private projectFor(projectId: ProjectId): MacHostProjectConfig {
    const project = this.options.config.projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new Error(`Unknown Mac Host project: ${projectId}`);
    }
    return project;
  }

  private sendMaybe(event: CodexLinkEvent | null): void {
    if (event) {
      this.send(event);
    }
  }

  private send(event: CodexLinkEvent): void {
    this.options.relay.sendHostEvent(event);
  }
}

function isStartCodexTurnCommand(value: unknown): value is StartCodexTurnCommand {
  if (!value || typeof value !== "object") {
    return false;
  }
  const command = value as Partial<StartCodexTurnCommand>;
  return (
    command.type === "codex.turn.start" &&
    typeof command.projectId === "string" &&
    typeof command.prompt === "string" &&
    (command.threadId === undefined || typeof command.threadId === "string") &&
    (command.cwd === undefined || typeof command.cwd === "string")
  );
}

function isSteerCodexTurnCommand(value: unknown): value is SteerCodexTurnCommand {
  if (!value || typeof value !== "object") {
    return false;
  }
  const command = value as Partial<SteerCodexTurnCommand>;
  return (
    command.type === "codex.turn.steer" &&
    typeof command.threadId === "string" &&
    typeof command.turnId === "string" &&
    typeof command.prompt === "string"
  );
}

function isInterruptCodexTurnCommand(value: unknown): value is InterruptCodexTurnCommand {
  if (!value || typeof value !== "object") {
    return false;
  }
  const command = value as Partial<InterruptCodexTurnCommand>;
  return (
    command.type === "codex.turn.interrupt" &&
    typeof command.threadId === "string" &&
    typeof command.turnId === "string"
  );
}

function isResolveCodexApprovalCommand(value: unknown): value is ResolveCodexApprovalCommand {
  if (!value || typeof value !== "object") {
    return false;
  }
  const command = value as Partial<ResolveCodexApprovalCommand>;
  return (
    command.type === "codex.approval.resolve" &&
    typeof command.requestId === "string" &&
    isApprovalDecision(command.decision)
  );
}

function isRestoreCodexThreadCommand(value: unknown): value is RestoreCodexThreadCommand {
  if (!value || typeof value !== "object") {
    return false;
  }
  const command = value as Partial<RestoreCodexThreadCommand>;
  return (
    command.type === "codex.thread.restore" &&
    typeof command.projectId === "string" &&
    typeof command.threadId === "string"
  );
}

function isApprovalDecision(value: unknown): value is ApprovalDecisionKind {
  return (
    value === "accept" ||
    value === "accept_for_session" ||
    value === "decline" ||
    value === "cancel"
  );
}

function decisionToCodex(decision: ApprovalDecisionKind): string {
  if (decision === "accept_for_session") {
    return "acceptForSession";
  }
  return decision;
}

function requestIdFromServerRequestResolved(params: unknown): string | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  const requestId = (params as { requestId?: unknown }).requestId;
  if (typeof requestId === "string") {
    return requestId;
  }
  if (typeof requestId === "number") {
    return String(requestId);
  }
  return null;
}

function isListCodexThreadsCommand(value: unknown): value is ListCodexThreadsCommand {
  if (!value || typeof value !== "object") {
    return false;
  }
  const command = value as Partial<ListCodexThreadsCommand>;
  return (
    command.type === "codex.thread.list" &&
    typeof command.projectId === "string" &&
    (command.limit === undefined || typeof command.limit === "number")
  );
}

function isListCodexThreadTurnsCommand(value: unknown): value is ListCodexThreadTurnsCommand {
  if (!value || typeof value !== "object") {
    return false;
  }
  const command = value as Partial<ListCodexThreadTurnsCommand>;
  return (
    command.type === "codex.thread.turns.list" &&
    typeof command.projectId === "string" &&
    typeof command.threadId === "string" &&
    (command.limit === undefined || typeof command.limit === "number")
  );
}

function threadIdFromResponse(response: unknown): ThreadId | null {
  if (!response || typeof response !== "object") {
    return null;
  }
  const thread = (response as { thread?: unknown }).thread;
  if (!thread || typeof thread !== "object") {
    return null;
  }
  const threadId = (thread as { id?: unknown }).id;
  return typeof threadId === "string" ? (threadId as ThreadId) : null;
}

function applyVscodePatches(target: Record<string, unknown>, patches: Array<Record<string, unknown>>): void {
  for (const patch of patches) {
    const pathRaw = (patch as { path?: unknown }).path;
    const pathParts: string[] = Array.isArray(pathRaw)
      ? (pathRaw as unknown[]).map((segment) => String(segment))
      : typeof pathRaw === "string"
        ? pathRaw.split("/").filter((segment) => segment.length > 0)
        : [];
    if (pathParts.length === 0) continue;
    let parent: unknown = target;
    for (let i = 0; i < pathParts.length - 1; i += 1) {
      const segment = pathParts[i];
      if (segment === undefined) {
        parent = null;
        break;
      }
      if (parent && typeof parent === "object") {
        parent = (parent as Record<string, unknown>)[segment];
      } else {
        parent = null;
        break;
      }
    }
    if (parent == null || typeof parent !== "object") continue;
    const lastKey = pathParts[pathParts.length - 1];
    if (lastKey === undefined) continue;
    const op = (patch as { op?: unknown }).op;
    const value = (patch as { value?: unknown }).value;
    if (op === "remove") {
      if (Array.isArray(parent)) {
        (parent as unknown[]).splice(Number(lastKey), 1);
      } else {
        delete (parent as Record<string, unknown>)[lastKey];
      }
      continue;
    }
    if (op === "add" && Array.isArray(parent)) {
      const arr = parent as unknown[];
      const idx = lastKey === "-" ? arr.length : Number(lastKey);
      arr.splice(idx, 0, value);
      continue;
    }
    (parent as Record<string, unknown>)[lastKey] = value;
  }
}
