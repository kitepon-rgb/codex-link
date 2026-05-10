import Foundation

public struct Host: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let ownerUserId: String
    public let deviceId: String
    public let name: String
    public let platform: String
    public var status: HostStatus

    public init(
        id: String,
        ownerUserId: String,
        deviceId: String,
        name: String,
        platform: String,
        status: HostStatus
    ) {
        self.id = id
        self.ownerUserId = ownerUserId
        self.deviceId = deviceId
        self.name = name
        self.platform = platform
        self.status = status
    }
}

public enum HostStatus: String, Codable, Equatable, Sendable {
    case online
    case offline
}

public struct ProjectRef: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let hostId: String
    public let name: String
    public let pathLabel: String

    public init(id: String, hostId: String, name: String, pathLabel: String) {
        self.id = id
        self.hostId = hostId
        self.name = name
        self.pathLabel = pathLabel
    }
}

public struct ThreadRef: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let projectId: String
    public let title: String?

    public init(id: String, projectId: String, title: String?) {
        self.id = id
        self.projectId = projectId
        self.title = title
    }
}

public enum TurnStatus: String, Codable, Equatable, Hashable, Sendable {
    case idle
    case running
    case waitingForApproval = "waiting_for_approval"
    case completed
    case failed
    case canceled
}

public enum ApprovalKind: String, Codable, Equatable, Sendable {
    case commandExecution = "command_execution"
    case fileChange = "file_change"
    case network
    case userInput = "user_input"
}

public enum ApprovalDecisionKind: String, Codable, Equatable, Sendable {
    case accept
    case acceptForSession = "accept_for_session"
    case decline
    case cancel
}

public struct ApprovalRequest: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let kind: ApprovalKind
    public let threadId: String
    public let turnId: String
    public let itemId: String?
    public let title: String
    public let detail: String
    public let availableDecisions: [ApprovalDecisionKind]

    public init(
        id: String,
        kind: ApprovalKind,
        threadId: String,
        turnId: String,
        itemId: String?,
        title: String,
        detail: String,
        availableDecisions: [ApprovalDecisionKind]
    ) {
        self.id = id
        self.kind = kind
        self.threadId = threadId
        self.turnId = turnId
        self.itemId = itemId
        self.title = title
        self.detail = detail
        self.availableDecisions = availableDecisions
    }
}

public struct TranscriptItem: Equatable, Identifiable, Sendable {
    public let id: String
    public let threadId: String
    public let turnId: String
    public let role: TranscriptRole
    public var text: String

    public init(id: String, threadId: String, turnId: String, role: TranscriptRole, text: String) {
        self.id = id
        self.threadId = threadId
        self.turnId = turnId
        self.role = role
        self.text = text
    }
}

public enum TranscriptRole: String, Codable, Equatable, Sendable {
    case user
    case assistant
}

public struct TimelineItem: Equatable, Identifiable, Sendable {
    public let id: String
    public let threadId: String
    public let turnId: String
    public var label: String
    public var status: TimelineStatus

    public init(
        id: String,
        threadId: String,
        turnId: String,
        label: String,
        status: TimelineStatus
    ) {
        self.id = id
        self.threadId = threadId
        self.turnId = turnId
        self.label = label
        self.status = status
    }
}

public enum TimelineStatus: String, Codable, Equatable, Sendable {
    case running
    case completed
    case failed
    case declined
}

public struct LiveActivityState: Equatable, Sendable {
    public var hostName: String
    public var projectName: String
    public var status: TurnStatus
    public var latestText: String?
    public var approvalRequired: Bool

    public init(
        hostName: String,
        projectName: String,
        status: TurnStatus,
        latestText: String?,
        approvalRequired: Bool
    ) {
        self.hostName = hostName
        self.projectName = projectName
        self.status = status
        self.latestText = latestText
        self.approvalRequired = approvalRequired
    }
}

public enum DiagnosticSeverity: String, Codable, Equatable, Sendable {
    case info
    case warning
    case error
}

public struct DiagnosticEvent: Codable, Equatable, Identifiable, Sendable {
    public var id: String { "\(scope)-\(severity.rawValue)-\(message)" }
    public let scope: String
    public let severity: DiagnosticSeverity
    public let message: String

    public init(scope: String, severity: DiagnosticSeverity, message: String) {
        self.scope = scope
        self.severity = severity
        self.message = message
    }
}
