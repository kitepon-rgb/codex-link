import Foundation

public struct CachedRelayEvent: Codable, Equatable, Sendable {
    public let sequence: Int
    public let hostId: String
    public let event: CodexLinkEvent
    public let receivedAt: String
}

public enum RelayServerMessage: Equatable, Sendable {
    case ready(role: String, connectionId: String)
    case error(code: String, message: String)
    case hostEvent(CachedRelayEvent)
    case hostSubscriptionReady(hostId: String, afterSequence: Int, latestSequence: Int)
    case hostMessage(payload: Data)
}

extension RelayServerMessage: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type
        case role
        case connectionId
        case code
        case message
        case event
        case hostId
        case afterSequence
        case latestSequence
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "relay.ready":
            self = .ready(
                role: try container.decode(String.self, forKey: .role),
                connectionId: try container.decode(String.self, forKey: .connectionId)
            )
        case "relay.error":
            self = .error(
                code: try container.decode(String.self, forKey: .code),
                message: try container.decode(String.self, forKey: .message)
            )
        case "host.event":
            self = .hostEvent(try container.decode(CachedRelayEvent.self, forKey: .event))
        case "host.subscription.ready":
            self = .hostSubscriptionReady(
                hostId: try container.decode(String.self, forKey: .hostId),
                afterSequence: try container.decode(Int.self, forKey: .afterSequence),
                latestSequence: try container.decode(Int.self, forKey: .latestSequence)
            )
        case "host.message":
            self = .hostMessage(payload: Data())
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Unknown Relay server message type: \(type)"
            )
        }
    }
}

public enum CodexLinkEvent: Equatable, Sendable {
    case hostOnline(Host)
    case hostOffline(hostId: String)
    case hostCapabilitiesUpdated(hostId: String)
    case projectListUpdated(hostId: String, projects: [ProjectRef])
    case threadStarted(ThreadRef)
    case turnStatusChanged(turnId: String, status: TurnStatus)
    case assistantDelta(threadId: String, turnId: String, text: String)
    case assistantFinal(threadId: String, turnId: String, itemId: String, text: String)
    case transcriptItemRecorded(
        threadId: String,
        turnId: String,
        itemId: String,
        role: TranscriptRole,
        text: String
    )
    case timelineItemStarted(threadId: String, turnId: String, itemId: String, label: String)
    case timelineItemCompleted(
        threadId: String,
        turnId: String,
        itemId: String,
        status: TimelineStatus
    )
    case approvalRequested(ApprovalRequest)
    case approvalResolved(requestId: String, decision: ApprovalDecisionKind)
    case rateLimitUpdated
    case diagnosticReported(DiagnosticEvent)
    case errorReported(scope: String, message: String)
}

extension CodexLinkEvent: Codable {
    private enum CodingKeys: String, CodingKey {
        case type
        case host
        case hostId
        case capabilities
        case projects
        case thread
        case turnId
        case status
        case threadId
        case text
        case itemId
        case label
        case role
        case request
        case requestId
        case decision
        case diagnostic
        case scope
        case message
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "host.online":
            self = .hostOnline(try container.decode(Host.self, forKey: .host))
        case "host.offline":
            self = .hostOffline(hostId: try container.decode(String.self, forKey: .hostId))
        case "host.capabilities.updated":
            self = .hostCapabilitiesUpdated(hostId: try container.decode(String.self, forKey: .hostId))
        case "project.list.updated":
            self = .projectListUpdated(
                hostId: try container.decode(String.self, forKey: .hostId),
                projects: try container.decode([ProjectRef].self, forKey: .projects)
            )
        case "thread.started":
            self = .threadStarted(try container.decode(ThreadRef.self, forKey: .thread))
        case "turn.status.changed":
            self = .turnStatusChanged(
                turnId: try container.decode(String.self, forKey: .turnId),
                status: try container.decode(TurnStatus.self, forKey: .status)
            )
        case "assistant.delta":
            self = .assistantDelta(
                threadId: try container.decode(String.self, forKey: .threadId),
                turnId: try container.decode(String.self, forKey: .turnId),
                text: try container.decode(String.self, forKey: .text)
            )
        case "assistant.final":
            self = .assistantFinal(
                threadId: try container.decode(String.self, forKey: .threadId),
                turnId: try container.decode(String.self, forKey: .turnId),
                itemId: try container.decode(String.self, forKey: .itemId),
                text: try container.decode(String.self, forKey: .text)
            )
        case "transcript.item.recorded":
            self = .transcriptItemRecorded(
                threadId: try container.decode(String.self, forKey: .threadId),
                turnId: try container.decode(String.self, forKey: .turnId),
                itemId: try container.decode(String.self, forKey: .itemId),
                role: try container.decode(TranscriptRole.self, forKey: .role),
                text: try container.decode(String.self, forKey: .text)
            )
        case "timeline.item.started":
            self = .timelineItemStarted(
                threadId: try container.decode(String.self, forKey: .threadId),
                turnId: try container.decode(String.self, forKey: .turnId),
                itemId: try container.decode(String.self, forKey: .itemId),
                label: try container.decode(String.self, forKey: .label)
            )
        case "timeline.item.completed":
            self = .timelineItemCompleted(
                threadId: try container.decode(String.self, forKey: .threadId),
                turnId: try container.decode(String.self, forKey: .turnId),
                itemId: try container.decode(String.self, forKey: .itemId),
                status: try container.decode(TimelineStatus.self, forKey: .status)
            )
        case "approval.requested":
            self = .approvalRequested(try container.decode(ApprovalRequest.self, forKey: .request))
        case "approval.resolved":
            self = .approvalResolved(
                requestId: try container.decode(String.self, forKey: .requestId),
                decision: try container.decode(ApprovalDecisionKind.self, forKey: .decision)
            )
        case "rate_limit.updated":
            self = .rateLimitUpdated
        case "diagnostic.reported":
            self = .diagnosticReported(
                try container.decode(DiagnosticEvent.self, forKey: .diagnostic)
            )
        case "error.reported":
            self = .errorReported(
                scope: try container.decode(String.self, forKey: .scope),
                message: try container.decode(String.self, forKey: .message)
            )
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Unknown Codex Link event type: \(type)"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .hostOnline(let host):
            try container.encode("host.online", forKey: .type)
            try container.encode(host, forKey: .host)
        case .hostOffline(let hostId):
            try container.encode("host.offline", forKey: .type)
            try container.encode(hostId, forKey: .hostId)
        case .hostCapabilitiesUpdated(let hostId):
            try container.encode("host.capabilities.updated", forKey: .type)
            try container.encode(hostId, forKey: .hostId)
        case .projectListUpdated(let hostId, let projects):
            try container.encode("project.list.updated", forKey: .type)
            try container.encode(hostId, forKey: .hostId)
            try container.encode(projects, forKey: .projects)
        case .threadStarted(let thread):
            try container.encode("thread.started", forKey: .type)
            try container.encode(thread, forKey: .thread)
        case .turnStatusChanged(let turnId, let status):
            try container.encode("turn.status.changed", forKey: .type)
            try container.encode(turnId, forKey: .turnId)
            try container.encode(status, forKey: .status)
        default:
            throw EncodingError.invalidValue(self, .init(
                codingPath: encoder.codingPath,
                debugDescription: "Encoding is only implemented for outbound-safe events"
            ))
        }
    }
}
