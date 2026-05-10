import Foundation

public struct CodexLinkSessionSelection: Equatable, Sendable {
    public var hostId: String?
    public var projectId: String?
    public var threadId: String?
    public var activeTurnId: String?

    public init(
        hostId: String? = nil,
        projectId: String? = nil,
        threadId: String? = nil,
        activeTurnId: String? = nil
    ) {
        self.hostId = hostId
        self.projectId = projectId
        self.threadId = threadId
        self.activeTurnId = activeTurnId
    }
}

public enum CodexLinkUIAction: Equatable, Sendable {
    case selectHost(hostId: String)
    case selectProject(projectId: String)
    case selectThread(projectId: String, threadId: String)
    case restoreThread(projectId: String, threadId: String)
    case sendPrompt(projectId: String, threadId: String?, prompt: String)
    case steerPrompt(threadId: String, turnId: String, prompt: String)
    case interrupt(threadId: String, turnId: String)
    case approvalDecision(requestId: String, decision: ApprovalDecisionKind)
    case showHostSwitcher
    case showInspector
    case unsupportedOperation(reason: String)
}
