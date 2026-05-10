import Foundation

public struct CodexLinkProjection: Equatable, Sendable {
    public private(set) var hosts: [String: Host] = [:]
    public private(set) var projectsByHost: [String: [ProjectRef]] = [:]
    public private(set) var threads: [String: ThreadRef] = [:]
    public private(set) var turnStatus: [String: TurnStatus] = [:]
    public private(set) var transcript: [TranscriptItem] = []
    public private(set) var timeline: [TimelineItem] = []
    public private(set) var approvals: [ApprovalRequest] = []
    public private(set) var finalResponses: [String: String] = [:]
    public private(set) var diagnostics: [DiagnosticEvent] = []
    public private(set) var latestError: String?

    public init() {}

    public mutating func apply(_ event: CodexLinkEvent) {
        switch event {
        case .hostOnline(let host):
            hosts[host.id] = host
        case .hostOffline(let hostId):
            hosts[hostId]?.status = .offline
        case .hostCapabilitiesUpdated:
            break
        case .projectListUpdated(let hostId, let projects):
            projectsByHost[hostId] = projects
        case .threadStarted(let thread):
            threads[thread.id] = thread
        case .turnStatusChanged(_, let turnId, let status):
            turnStatus[turnId] = status
        case .assistantDelta(let threadId, let turnId, let text):
            appendAssistantDelta(threadId: threadId, turnId: turnId, text: text)
        case .assistantFinal(_, let turnId, _, let text):
            finalResponses[turnId] = text
        case .transcriptItemRecorded(let threadId, let turnId, let itemId, let role, let text):
            recordTranscriptItem(
                TranscriptItem(id: itemId, threadId: threadId, turnId: turnId, role: role, text: text)
            )
        case .timelineItemStarted(let threadId, let turnId, let itemId, let label):
            upsertTimelineItem(
                TimelineItem(id: itemId, threadId: threadId, turnId: turnId, label: label, status: .running)
            )
        case .timelineItemCompleted(_, _, let itemId, let status):
            if let index = timeline.firstIndex(where: { $0.id == itemId }) {
                timeline[index].status = status
            }
        case .approvalRequested(let request):
            if !approvals.contains(where: { $0.id == request.id }) {
                approvals.append(request)
            }
            turnStatus[request.turnId] = .waitingForApproval
        case .approvalResolved(let requestId, _):
            approvals.removeAll { $0.id == requestId }
        case .rateLimitUpdated:
            break
        case .diagnosticReported(let diagnostic):
            diagnostics.append(diagnostic)
        case .errorReported(_, let message):
            latestError = message
        }
    }

    public func liveActivityState(hostId: String, projectId: String, turnId: String) -> LiveActivityState {
        let hostName = hosts[hostId]?.name ?? "Host"
        let projectName = projectsByHost[hostId]?.first(where: { $0.id == projectId })?.name ?? "Project"
        let status = turnStatus[turnId] ?? .idle
        let latestText = transcript.last(where: { $0.turnId == turnId })?.text
        return LiveActivityState(
            hostName: hostName,
            projectName: projectName,
            status: status,
            latestText: latestText,
            approvalRequired: approvals.contains(where: { $0.turnId == turnId })
        )
    }

    private mutating func appendAssistantDelta(threadId: String, turnId: String, text: String) {
        if let index = transcript.lastIndex(where: {
            $0.threadId == threadId && $0.turnId == turnId && $0.role == .assistant
        }) {
            transcript[index].text += text
            return
        }
        transcript.append(TranscriptItem(
            id: "assistant-delta-\(turnId)",
            threadId: threadId,
            turnId: turnId,
            role: .assistant,
            text: text
        ))
    }

    private mutating func recordTranscriptItem(_ item: TranscriptItem) {
        if let index = transcript.firstIndex(where: { $0.id == item.id }) {
            transcript[index] = item
            return
        }
        transcript.append(item)
    }

    private mutating func upsertTimelineItem(_ item: TimelineItem) {
        if let index = timeline.firstIndex(where: { $0.id == item.id }) {
            timeline[index] = item
            return
        }
        timeline.append(item)
    }
}
