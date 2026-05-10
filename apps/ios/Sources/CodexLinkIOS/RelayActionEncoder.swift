import Foundation

public enum CodexLinkRelayActionEncodingError: Error, Equatable, Sendable {
    case missingHostId
    case localOnlyAction(String)
    case unsupportedAction(String)
}

public struct CodexLinkRelayActionEncoder: Sendable {
    private let encoder: JSONEncoder

    public init(encoder: JSONEncoder = JSONEncoder()) {
        self.encoder = encoder
    }

    public func encode(
        _ action: CodexLinkUIAction,
        currentHostId: String?,
        afterSequence: Int? = nil
    ) throws -> Data {
        switch action {
        case .pairHost:
            throw CodexLinkRelayActionEncodingError.localOnlyAction("pairHost")
        case .revokeDeviceSession:
            throw CodexLinkRelayActionEncodingError.localOnlyAction("revokeDeviceSession")
        case .selectHost(let hostId):
            return try encoder.encode(ClientSubscribeHostMessage(
                hostId: hostId,
                afterSequence: afterSequence
            ))
        case .selectProject(let projectId):
            return try encodeToHost(
                hostId: try requireHostId(currentHostId),
                payload: ListThreadsCommand(projectId: projectId)
            )
        case .selectThread(let projectId, let threadId),
             .restoreThread(let projectId, let threadId):
            return try encodeToHost(
                hostId: try requireHostId(currentHostId),
                payload: RestoreThreadCommand(projectId: projectId, threadId: threadId)
            )
        case .sendPrompt(let projectId, let threadId, let prompt):
            return try encodeToHost(
                hostId: try requireHostId(currentHostId),
                payload: StartTurnCommand(projectId: projectId, prompt: prompt, threadId: threadId)
            )
        case .steerPrompt(let threadId, let turnId, let prompt):
            return try encodeToHost(
                hostId: try requireHostId(currentHostId),
                payload: SteerTurnCommand(threadId: threadId, turnId: turnId, prompt: prompt)
            )
        case .interrupt(let threadId, let turnId):
            return try encodeToHost(
                hostId: try requireHostId(currentHostId),
                payload: InterruptTurnCommand(threadId: threadId, turnId: turnId)
            )
        case .approvalDecision(let requestId, let decision):
            return try encodeToHost(
                hostId: try requireHostId(currentHostId),
                payload: ResolveApprovalCommand(requestId: requestId, decision: decision)
            )
        case .showHostSwitcher:
            throw CodexLinkRelayActionEncodingError.localOnlyAction("showHostSwitcher")
        case .showInspector:
            throw CodexLinkRelayActionEncodingError.localOnlyAction("showInspector")
        case .unsupportedOperation(let reason):
            throw CodexLinkRelayActionEncodingError.unsupportedAction(reason)
        }
    }

    private func requireHostId(_ hostId: String?) throws -> String {
        guard let hostId else {
            throw CodexLinkRelayActionEncodingError.missingHostId
        }
        return hostId
    }

    private func encodeToHost<Payload: Encodable & Sendable>(
        hostId: String,
        payload: Payload
    ) throws -> Data {
        try encoder.encode(ClientToHostMessage(hostId: hostId, payload: payload))
    }
}
