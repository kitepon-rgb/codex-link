import XCTest
@testable import CodexLinkIOS

final class ProjectionTests: XCTestCase {
    func testDecodesRelayHostEventsAndProjectsVisibleState() throws {
        let json = """
        {
          "type": "host.event",
          "event": {
            "sequence": 1,
            "hostId": "host_1",
            "receivedAt": "2026-05-10T00:00:00Z",
            "event": {
              "type": "thread.started",
              "thread": {
                "id": "thread_1",
                "projectId": "project_1",
                "title": "Hello"
              }
            }
          }
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(RelayServerMessage.self, from: json)

        guard case .hostEvent(let cached) = message else {
            return XCTFail("Expected host.event")
        }
        XCTAssertEqual(cached.event, .threadStarted(ThreadRef(
            id: "thread_1",
            projectId: "project_1",
            title: "Hello"
        )))
    }

    func testProjectionTracksTranscriptTimelineApprovalsAndLiveActivity() {
        var projection = CodexLinkProjection()
        projection.apply(.hostOnline(Host(
            id: "host_1",
            ownerUserId: "usr_1",
            deviceId: "dev_1",
            name: "MacBook",
            platform: "macos",
            status: .online
        )))
        projection.apply(.projectListUpdated(
            hostId: "host_1",
            projects: [ProjectRef(
                id: "project_1",
                hostId: "host_1",
                name: "Codex Link",
                pathLabel: "/repo"
            )]
        ))
        projection.apply(.threadStarted(ThreadRef(
            id: "thread_1",
            projectId: "project_1",
            title: "Thread"
        )))
        projection.apply(.turnStatusChanged(turnId: "turn_1", status: .running))
        projection.apply(.transcriptItemRecorded(
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "item_user",
            role: .user,
            text: "Hello"
        ))
        projection.apply(.timelineItemStarted(
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "item_command",
            label: "pnpm test"
        ))
        projection.apply(.approvalRequested(ApprovalRequest(
            id: "approval_1",
            kind: .commandExecution,
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "item_command",
            title: "Command approval",
            detail: "pnpm test",
            availableDecisions: [.accept, .decline]
        )))

        XCTAssertEqual(projection.transcript.map(\.text), ["Hello"])
        XCTAssertEqual(projection.timeline.first?.status, .running)
        XCTAssertEqual(projection.approvals.map(\.id), ["approval_1"])

        let liveActivity = projection.liveActivityState(
            hostId: "host_1",
            projectId: "project_1",
            turnId: "turn_1"
        )
        XCTAssertEqual(liveActivity.hostName, "MacBook")
        XCTAssertEqual(liveActivity.projectName, "Codex Link")
        XCTAssertEqual(liveActivity.status, .waitingForApproval)
        XCTAssertTrue(liveActivity.approvalRequired)
    }

    func testEncodesTurnStartCommandForRelay() throws {
        let message = ClientToHostMessage(
            hostId: "host_1",
            payload: StartTurnCommand(projectId: "project_1", prompt: "Hello")
        )
        let data = try JSONEncoder().encode(message)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(object?["type"] as? String, "client.toHost")
        XCTAssertEqual(object?["hostId"] as? String, "host_1")
        let payload = object?["payload"] as? [String: Any]
        XCTAssertEqual(payload?["type"] as? String, "codex.turn.start")
        XCTAssertEqual(payload?["projectId"] as? String, "project_1")
        XCTAssertEqual(payload?["prompt"] as? String, "Hello")
    }

    func testActionEncoderMapsSendPromptToRelayMessage() throws {
        let encoder = CodexLinkRelayActionEncoder()
        let data = try encoder.encode(
            .sendPrompt(projectId: "project_1", threadId: "thread_1", prompt: "Ship it"),
            currentHostId: "host_1"
        )
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(object?["type"] as? String, "client.toHost")
        XCTAssertEqual(object?["hostId"] as? String, "host_1")
        let payload = object?["payload"] as? [String: Any]
        XCTAssertEqual(payload?["type"] as? String, "codex.turn.start")
        XCTAssertEqual(payload?["projectId"] as? String, "project_1")
        XCTAssertEqual(payload?["threadId"] as? String, "thread_1")
        XCTAssertEqual(payload?["prompt"] as? String, "Ship it")
    }

    func testActionEncoderMapsApprovalDecisionToRelayMessage() throws {
        let encoder = CodexLinkRelayActionEncoder()
        let data = try encoder.encode(
            .approvalDecision(requestId: "approval_1", decision: .accept),
            currentHostId: "host_1"
        )
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(object?["type"] as? String, "client.toHost")
        XCTAssertEqual(object?["hostId"] as? String, "host_1")
        let payload = object?["payload"] as? [String: Any]
        XCTAssertEqual(payload?["type"] as? String, "codex.approval.resolve")
        XCTAssertEqual(payload?["requestId"] as? String, "approval_1")
        XCTAssertEqual(payload?["decision"] as? String, "accept")
    }

    func testRestoresPreviousSelectionWhenProjectedEntitiesExist() {
        var projection = CodexLinkProjection()
        projection.apply(.hostOnline(Host(
            id: "host_1",
            ownerUserId: "usr_1",
            deviceId: "dev_1",
            name: "MacBook",
            platform: "macos",
            status: .online
        )))
        projection.apply(.projectListUpdated(
            hostId: "host_1",
            projects: [ProjectRef(
                id: "project_1",
                hostId: "host_1",
                name: "Codex Link",
                pathLabel: "/repo"
            )]
        ))
        projection.apply(.threadStarted(ThreadRef(
            id: "thread_1",
            projectId: "project_1",
            title: "Thread"
        )))
        projection.apply(.turnStatusChanged(turnId: "turn_1", status: .running))

        let selection = CodexLinkSessionRestore.selection(
            from: CodexLinkSessionBookmark(
                hostId: "host_1",
                projectId: "project_1",
                threadId: "thread_1",
                activeTurnId: "turn_1",
                lastRelaySequence: 42
            ),
            projection: projection
        )

        XCTAssertEqual(selection, CodexLinkSessionSelection(
            hostId: "host_1",
            projectId: "project_1",
            threadId: "thread_1",
            activeTurnId: "turn_1"
        ))
    }

    func testRestoreFallsBackToHostPickerWhenHostIsMissing() {
        let selection = CodexLinkSessionRestore.selection(
            from: CodexLinkSessionBookmark(
                hostId: "missing_host",
                projectId: "project_1",
                threadId: "thread_1",
                activeTurnId: "turn_1"
            ),
            projection: CodexLinkProjection()
        )

        XCTAssertEqual(selection, CodexLinkSessionSelection())
    }
}
