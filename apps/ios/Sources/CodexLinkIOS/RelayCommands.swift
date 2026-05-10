import Foundation

public struct ClientSubscribeHostMessage: Encodable, Equatable, Sendable {
    public let type = "client.subscribeHost"
    public let hostId: String
    public let afterSequence: Int?

    public init(hostId: String, afterSequence: Int? = nil) {
        self.hostId = hostId
        self.afterSequence = afterSequence
    }
}

public struct ClientToHostMessage<Payload: Encodable & Sendable>: Encodable, Sendable {
    public let type = "client.toHost"
    public let hostId: String
    public let payload: Payload

    public init(hostId: String, payload: Payload) {
        self.hostId = hostId
        self.payload = payload
    }
}

public struct StartTurnCommand: Encodable, Equatable, Sendable {
    public let type = "codex.turn.start"
    public let projectId: String
    public let prompt: String
    public let threadId: String?

    public init(projectId: String, prompt: String, threadId: String? = nil) {
        self.projectId = projectId
        self.prompt = prompt
        self.threadId = threadId
    }
}

public struct SteerTurnCommand: Encodable, Equatable, Sendable {
    public let type = "codex.turn.steer"
    public let threadId: String
    public let turnId: String
    public let prompt: String

    public init(threadId: String, turnId: String, prompt: String) {
        self.threadId = threadId
        self.turnId = turnId
        self.prompt = prompt
    }
}

public struct InterruptTurnCommand: Encodable, Equatable, Sendable {
    public let type = "codex.turn.interrupt"
    public let threadId: String
    public let turnId: String

    public init(threadId: String, turnId: String) {
        self.threadId = threadId
        self.turnId = turnId
    }
}

public struct ResolveApprovalCommand: Encodable, Equatable, Sendable {
    public let type = "codex.approval.resolve"
    public let requestId: String
    public let decision: ApprovalDecisionKind

    public init(requestId: String, decision: ApprovalDecisionKind) {
        self.requestId = requestId
        self.decision = decision
    }
}

public struct RestoreThreadCommand: Encodable, Equatable, Sendable {
    public let type = "codex.thread.restore"
    public let projectId: String
    public let threadId: String

    public init(projectId: String, threadId: String) {
        self.projectId = projectId
        self.threadId = threadId
    }
}

public struct ListThreadsCommand: Encodable, Equatable, Sendable {
    public let type = "codex.thread.list"
    public let projectId: String
    public let limit: Int?

    public init(projectId: String, limit: Int? = 50) {
        self.projectId = projectId
        self.limit = limit
    }
}

public struct ListThreadTurnsCommand: Encodable, Equatable, Sendable {
    public let type = "codex.thread.turns.list"
    public let projectId: String
    public let threadId: String
    public let limit: Int?

    public init(projectId: String, threadId: String, limit: Int? = 100) {
        self.projectId = projectId
        self.threadId = threadId
        self.limit = limit
    }
}
