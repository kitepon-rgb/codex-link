import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
struct CodexLinkPreviewCanvas: View {
    @State private var projection: CodexLinkProjection
    @State private var selection: CodexLinkSessionSelection
    private let connectionState: CodexLinkConnectionState

    init(state: CodexLinkPreviewState = .approval) {
        let fixture = CodexLinkPreviewData.fixture(state: state)
        self._projection = State(initialValue: fixture.projection)
        self._selection = State(initialValue: fixture.selection)
        self.connectionState = fixture.connectionState
    }

    var body: some View {
        CodexLinkRootView(
            projection: projection,
            connectionState: connectionState,
            selection: $selection,
            onAction: handle
        )
    }

    private func handle(_ action: CodexLinkUIAction) {
        switch action {
        case .sendPrompt(let projectId, let threadId, let prompt):
            let resolvedThreadId = threadId ?? "thread_preview_new"
            let turnId = "turn_preview_\(Int(Date().timeIntervalSince1970))"
            if threadId == nil {
                projection.apply(.threadStarted(ThreadRef(
                    id: resolvedThreadId,
                    projectId: projectId,
                    title: prompt
                )))
                selection.threadId = resolvedThreadId
            }
            selection.activeTurnId = turnId
            projection.apply(.turnStatusChanged(threadId: "thread_1", turnId: turnId, status: .running))
            projection.apply(.transcriptItemRecorded(
                threadId: resolvedThreadId,
                turnId: turnId,
                itemId: "user_\(turnId)",
                role: .user,
                text: prompt
            ))
            projection.apply(.assistantDelta(
                threadId: resolvedThreadId,
                turnId: turnId,
                text: "Preview response for: \(prompt)"
            ))
        case .steerPrompt(let threadId, let turnId, let prompt):
            projection.apply(.transcriptItemRecorded(
                threadId: threadId,
                turnId: turnId,
                itemId: "steer_\(Int(Date().timeIntervalSince1970))",
                role: .user,
                text: prompt
            ))
        case .interrupt(_, let turnId):
            projection.apply(.turnStatusChanged(threadId: "thread_1", turnId: turnId, status: .canceled))
        case .approvalDecision(let requestId, let decision):
            projection.apply(.approvalResolved(requestId: requestId, decision: decision))
            projection.apply(.turnStatusChanged(threadId: "thread_1", turnId: "turn_2", status: .running))
        case .selectHost(let hostId):
            selection.hostId = hostId
        case .selectProject(let projectId):
            selection.projectId = projectId
        case .selectThread(let projectId, let threadId), .restoreThread(let projectId, let threadId):
            selection.projectId = projectId
            selection.threadId = threadId
        case .pairHost, .revokeDeviceSession, .showHostSwitcher, .showInspector, .unsupportedOperation:
            break
        }
    }
}

enum CodexLinkPreviewState {
    case hostPicker
    case running
    case approval
    case reconnecting
    case offline
}

struct CodexLinkPreviewFixture {
    var projection: CodexLinkProjection
    var selection: CodexLinkSessionSelection
    var connectionState: CodexLinkConnectionState
}

enum CodexLinkPreviewData {
    static func fixture(state: CodexLinkPreviewState) -> CodexLinkPreviewFixture {
        var projection = baseProjection(hostStatus: state == .offline ? .offline : .online)
        let selection = CodexLinkSessionSelection(
            hostId: state == .hostPicker ? nil : "host_1",
            projectId: state == .hostPicker ? nil : "project_1",
            threadId: state == .hostPicker ? nil : "thread_1",
            activeTurnId: state == .hostPicker ? nil : "turn_2"
        )

        let connectionState: CodexLinkConnectionState
        switch state {
        case .hostPicker:
            connectionState = .connected
            break
        case .running:
            connectionState = .connected
            projection.apply(.turnStatusChanged(threadId: "thread_1", turnId: "turn_2", status: .running))
            projection.apply(.timelineItemStarted(
                threadId: "thread_1",
                turnId: "turn_2",
                itemId: "timeline_1",
                label: "pnpm test",
                detail: nil
            ))
            projection.apply(.assistantDelta(
                threadId: "thread_1",
                turnId: "turn_2",
                text: "テストを実行しています。"
            ))
        case .approval:
            connectionState = .connected
            projection.apply(.turnStatusChanged(threadId: "thread_1", turnId: "turn_2", status: .waitingForApproval))
            projection.apply(.timelineItemStarted(
                threadId: "thread_1",
                turnId: "turn_2",
                itemId: "timeline_1",
                label: "swift test",
                detail: nil
            ))
            projection.apply(.approvalRequested(ApprovalRequest(
                id: "approval_1",
                kind: .commandExecution,
                threadId: "thread_1",
                turnId: "turn_2",
                itemId: "timeline_1",
                title: "Command approval",
                detail: "swift test\ncwd: ~/Developer/codex-link/apps/ios",
                availableDecisions: [.accept, .acceptForSession, .decline]
            )))
        case .reconnecting:
            connectionState = .reconnecting
            projection.apply(.turnStatusChanged(threadId: "thread_1", turnId: "turn_2", status: .running))
            projection.apply(.timelineItemStarted(
                threadId: "thread_1",
                turnId: "turn_2",
                itemId: "timeline_1",
                label: "Relay event cache restore",
                detail: nil
            ))
            projection.apply(.assistantDelta(
                threadId: "thread_1",
                turnId: "turn_2",
                text: "接続を復元しています。"
            ))
        case .offline:
            connectionState = .failed
            projection.apply(.turnStatusChanged(threadId: "thread_1", turnId: "turn_2", status: .failed))
            projection.apply(.timelineItemStarted(
                threadId: "thread_1",
                turnId: "turn_2",
                itemId: "timeline_1",
                label: "Relay reconnect",
                detail: nil
            ))
            projection.apply(.timelineItemCompleted(
                threadId: "thread_1",
                turnId: "turn_2",
                itemId: "timeline_1",
                status: .failed
            ))
            projection.apply(.errorReported(scope: "relay", message: "Host connection lost"))
        }

        return CodexLinkPreviewFixture(
            projection: projection,
            selection: selection,
            connectionState: connectionState
        )
    }

    private static func baseProjection(hostStatus: HostStatus) -> CodexLinkProjection {
        var projection = CodexLinkProjection()
        projection.apply(.hostOnline(Host(
            id: "host_1",
            ownerUserId: "usr_1",
            deviceId: "dev_1",
            name: "Kaito MacBook Air",
            platform: "macos",
            status: hostStatus
        )))
        projection.apply(.projectListUpdated(
            hostId: "host_1",
            projects: [
                ProjectRef(
                    id: "project_1",
                    hostId: "host_1",
                    name: "Codex Link",
                    pathLabel: "~/Developer/codex-link"
                ),
                ProjectRef(
                    id: "project_2",
                    hostId: "host_1",
                    name: "codex-rc",
                    pathLabel: "~/Developer/codex-rc"
                ),
            ]
        ))
        projection.apply(.threadStarted(ThreadRef(
            id: "thread_1",
            projectId: "project_1",
            title: "iPhone UI preview"
        )))
        projection.apply(.threadStarted(ThreadRef(
            id: "thread_2",
            projectId: "project_1",
            title: "Relay reconnect test"
        )))
        projection.apply(.turnStatusChanged(threadId: "thread_1", turnId: "turn_1", status: .completed))
        projection.apply(.transcriptItemRecorded(
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "user_1",
            role: .user,
            text: "iPhone から Codex を操作したい。ログは欠落させたくない。"
        ))
        projection.apply(.transcriptItemRecorded(
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "assistant_1",
            role: .assistant,
            text: "了解。Host、Relay、iPhone app の境界を保ったまま、会話中心の UI にします。"
        ))
        return projection
    }
}

#Preview("Conversation - Approval") {
    CodexLinkPreviewCanvas(state: .approval)
        .frame(width: 390, height: 844)
}

#Preview("Conversation - Running") {
    CodexLinkPreviewCanvas(state: .running)
        .frame(width: 390, height: 844)
}

#Preview("Host Picker") {
    CodexLinkPreviewCanvas(state: .hostPicker)
        .frame(width: 390, height: 844)
}

#Preview("Reconnecting") {
    CodexLinkPreviewCanvas(state: .reconnecting)
        .frame(width: 390, height: 844)
}

#Preview("Offline") {
    CodexLinkPreviewCanvas(state: .offline)
        .frame(width: 390, height: 844)
}
