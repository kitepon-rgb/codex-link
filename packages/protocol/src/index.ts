export type Id<T extends string> = string & { readonly __brand: T };

export type UserId = Id<"UserId">;
export type DeviceId = Id<"DeviceId">;
export type HostId = Id<"HostId">;
export type ConnectionId = Id<"ConnectionId">;
export type ProjectId = Id<"ProjectId">;
export type ThreadId = Id<"ThreadId">;
export type TurnId = Id<"TurnId">;
export type ItemId = Id<"ItemId">;
export type RequestId = Id<"RequestId">;

export interface User {
  id: UserId;
  displayName: string;
}

export interface Device {
  id: DeviceId;
  userId: UserId;
  name: string;
  kind: "iphone" | "mac-host";
  revokedAt: string | null;
}

export interface Host {
  id: HostId;
  ownerUserId: UserId;
  deviceId: DeviceId;
  name: string;
  platform: "macos";
  status: "online" | "offline";
}

export interface HostAccess {
  hostId: HostId;
  userId: UserId;
  role: "owner" | "operator" | "viewer";
}

export interface Connection {
  id: ConnectionId;
  deviceId: DeviceId;
  hostId?: HostId;
  connectedAt: string;
}

export interface ProjectRef {
  id: ProjectId;
  hostId: HostId;
  name: string;
  pathLabel: string;
}

export interface ThreadRef {
  id: ThreadId;
  projectId: ProjectId;
  title: string | null;
}

export interface TurnRef {
  id: TurnId;
  threadId: ThreadId;
}

export type TurnStatus =
  | "idle"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "canceled";

export type ApprovalKind =
  | "command_execution"
  | "file_change"
  | "network"
  | "user_input";

export interface ApprovalRequest {
  id: RequestId;
  kind: ApprovalKind;
  threadId: ThreadId;
  turnId: TurnId;
  itemId?: ItemId;
  title: string;
  detail: string;
  availableDecisions: ApprovalDecisionKind[];
}

export type ApprovalDecisionKind =
  | "accept"
  | "accept_for_session"
  | "decline"
  | "cancel";

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface DiagnosticEvent {
  scope: "host" | "relay" | "codex";
  severity: DiagnosticSeverity;
  message: string;
}

export interface ApprovalDecision {
  requestId: RequestId;
  decision: ApprovalDecisionKind;
}

export type CodexLinkEvent =
  | { type: "host.online"; host: Host }
  | { type: "host.offline"; hostId: HostId }
  | { type: "host.capabilities.updated"; hostId: HostId; capabilities: unknown }
  | { type: "project.list.updated"; hostId: HostId; projects: ProjectRef[] }
  | { type: "thread.started"; thread: ThreadRef }
  | { type: "turn.status.changed"; threadId: ThreadId; turnId: TurnId; status: TurnStatus }
  | { type: "assistant.delta"; threadId: ThreadId; turnId: TurnId; text: string }
  | {
      type: "assistant.final";
      threadId: ThreadId;
      turnId: TurnId;
      itemId: ItemId;
      text: string;
    }
  | {
      type: "transcript.item.recorded";
      threadId: ThreadId;
      turnId: TurnId;
      itemId: ItemId;
      role: "user" | "assistant";
      text: string;
    }
  | {
      type: "timeline.item.started";
      threadId: ThreadId;
      turnId: TurnId;
      itemId: ItemId;
      label: string;
      detail?: string;
    }
  | {
      type: "timeline.item.completed";
      threadId: ThreadId;
      turnId: TurnId;
      itemId: ItemId;
      status: "completed" | "failed" | "declined";
    }
  | { type: "approval.requested"; request: ApprovalRequest }
  | { type: "approval.resolved"; requestId: RequestId; decision?: ApprovalDecisionKind }
  | { type: "rate_limit.updated"; userId: UserId; usedPercent: number | null }
  | { type: "diagnostic.reported"; diagnostic: DiagnosticEvent }
  | { type: "error.reported"; scope: "host" | "relay" | "codex"; message: string };

export interface LiveActivityState {
  hostName: string;
  projectName: string;
  status: TurnStatus;
  latestText: string | null;
  approvalRequired: boolean;
}
