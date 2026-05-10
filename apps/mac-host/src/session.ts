import type {
  ApprovalDecisionKind,
  CodexLinkEvent,
  ProjectId,
  RequestId,
  ThreadId,
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

export interface StartCodexTurnCommand {
  type: "codex.turn.start";
  projectId: ProjectId;
  prompt: string;
  threadId?: ThreadId;
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
}

export class MacHostSessionRunner {
  private readonly pendingApprovalRequestIds = new Set<string>();
  private readonly pendingApprovalDecisions = new Map<string, ApprovalDecisionKind>();

  constructor(private readonly options: MacHostSessionRunnerOptions) {}

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
    const threadId = command.threadId ?? (await this.startThread(project));
    const turnResponse = await this.options.codex.startTurn({
      threadId,
      input: [{ type: "text", text: command.prompt, text_elements: [] }],
      cwd: project.path,
    });
    this.sendMaybe(turnStartResponseToEvent(turnResponse, threadId));
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
    this.options.codex.respondToServerRequest(command.requestId, {
      decision: decisionToCodex(command.decision),
    });
    this.pendingApprovalDecisions.set(command.requestId, command.decision);
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
    const event = codexServerRequestToEvent(message);
    if (event?.type === "approval.requested") {
      this.pendingApprovalRequestIds.add(event.request.id);
    }
    this.sendMaybe(event);
  }

  private async startThread(project: MacHostProjectConfig): Promise<ThreadId> {
    const threadResponse = await this.options.codex.startThread({
      cwd: project.path,
      serviceName: "codex-link-mac-host",
      approvalsReviewer: "user",
      experimentalRawEvents: true,
      persistExtendedHistory: false,
    });
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
    (command.threadId === undefined || typeof command.threadId === "string")
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
  return typeof requestId === "string" ? requestId : null;
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
