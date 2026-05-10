import XCTest
@testable import CodexLinkIOS

final class ProjectionTests: XCTestCase {
    func testDecodesPlaceholderDeviceSession() throws {
        let json = """
        {
          "relayUrl": "http://relay.test",
          "userId": "usr_1",
          "deviceId": "dev_1",
          "deviceToken": "device_token_1",
          "displayName": "owner",
          "deviceName": "Owner iPhone"
        }
        """.data(using: .utf8)!

        let session = try JSONDecoder().decode(CodexLinkDeviceSession.self, from: json)

        XCTAssertEqual(session, CodexLinkDeviceSession(
            relayUrl: "http://relay.test",
            userId: "usr_1",
            deviceId: "dev_1",
            deviceToken: "device_token_1",
            displayName: "owner",
            deviceName: "Owner iPhone"
        ))
    }

    func testEncodesPlaceholderDeviceSessionRequest() throws {
        let data = try JSONEncoder().encode(CodexLinkDeviceSessionRequest(
            displayName: "owner",
            deviceName: "Owner iPhone"
        ))
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(object?["displayName"] as? String, "owner")
        XCTAssertEqual(object?["deviceName"] as? String, "Owner iPhone")
    }

    func testEncodesDevicePairingRequestAndDecodesResult() throws {
        let data = try JSONEncoder().encode(CodexLinkDevicePairingRequest(
            userId: "usr_1",
            deviceId: "dev_1",
            pairingCode: "ABCD-EF12"
        ))
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(object?["userId"] as? String, "usr_1")
        XCTAssertEqual(object?["deviceId"] as? String, "dev_1")
        XCTAssertEqual(object?["pairingCode"] as? String, "ABCD-EF12")

        let response = """
        {
          "relayUrl": "http://relay.test",
          "userId": "usr_1",
          "deviceId": "dev_1",
          "hostId": "host_1",
          "hostName": "MacBook",
          "role": "operator"
        }
        """.data(using: .utf8)!

        XCTAssertEqual(
            try JSONDecoder().decode(CodexLinkDevicePairingResult.self, from: response),
            CodexLinkDevicePairingResult(
                relayUrl: "http://relay.test",
                userId: "usr_1",
                deviceId: "dev_1",
                hostId: "host_1",
                hostName: "MacBook",
                role: "operator"
            )
        )
    }

    func testEncodesDeviceRevocationRequestAndDecodesResult() throws {
        let data = try JSONEncoder().encode(CodexLinkDeviceRevocationRequest(
            userId: "usr_1",
            deviceId: "dev_1"
        ))
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(object?["userId"] as? String, "usr_1")
        XCTAssertEqual(object?["deviceId"] as? String, "dev_1")

        let response = """
        {
          "relayUrl": "http://relay.test",
          "userId": "usr_1",
          "deviceId": "dev_1",
          "revokedAt": "2026-05-10T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        XCTAssertEqual(
            try JSONDecoder().decode(CodexLinkDeviceRevocationResult.self, from: response),
            CodexLinkDeviceRevocationResult(
                relayUrl: "http://relay.test",
                userId: "usr_1",
                deviceId: "dev_1",
                revokedAt: "2026-05-10T00:00:00.000Z"
            )
        )
    }

    func testUserDefaultsDeviceSessionStorePersistsSession() throws {
        let suiteName = "CodexLinkDeviceSessionStoreTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer {
            defaults.removePersistentDomain(forName: suiteName)
        }
        let store = CodexLinkUserDefaultsDeviceSessionStore(defaults: defaults)
        let session = CodexLinkDeviceSession(
            relayUrl: "http://relay.test",
            userId: "usr_1",
            deviceId: "dev_1",
            deviceToken: "device_token_1",
            displayName: "owner",
            deviceName: "Owner iPhone"
        )

        try store.saveDeviceSession(session)

        XCTAssertEqual(try store.loadDeviceSession(), session)
        try store.clearDeviceSession()
        XCTAssertNil(try store.loadDeviceSession())
    }

    func testKeychainDeviceSessionStorePersistsSession() throws {
        let store = CodexLinkKeychainDeviceSessionStore(
            service: "CodexLinkDeviceSessionStoreTests-\(UUID().uuidString)",
            account: "device-session"
        )
        defer {
            try? store.clearDeviceSession()
        }
        let session = CodexLinkDeviceSession(
            relayUrl: "http://relay.test",
            userId: "usr_1",
            deviceId: "dev_1",
            deviceToken: "device_token_1",
            displayName: "owner",
            deviceName: "Owner iPhone"
        )

        XCTAssertNil(try store.loadDeviceSession())
        try store.saveDeviceSession(session)

        XCTAssertEqual(try store.loadDeviceSession(), session)
        try store.clearDeviceSession()
        XCTAssertNil(try store.loadDeviceSession())
    }

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

    func testDecodesHostSubscriptionReady() throws {
        let json = """
        {
          "type": "host.subscription.ready",
          "hostId": "host_1",
          "afterSequence": 7,
          "latestSequence": 12
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(RelayServerMessage.self, from: json)

        XCTAssertEqual(
            message,
            .hostSubscriptionReady(hostId: "host_1", afterSequence: 7, latestSequence: 12)
        )
    }

    func testDecodesTimelineDetail() throws {
        let json = """
        {
          "type": "host.event",
          "event": {
            "sequence": 2,
            "hostId": "host_1",
            "receivedAt": "2026-05-10T00:00:00Z",
            "event": {
              "type": "timeline.item.started",
              "threadId": "thread_1",
              "turnId": "turn_1",
              "itemId": "item_file",
              "label": "File change",
              "detail": "update: README.md\\n+hello"
            }
          }
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(RelayServerMessage.self, from: json)

        guard case .hostEvent(let cached) = message else {
            return XCTFail("Expected host.event")
        }
        XCTAssertEqual(
            cached.event,
            .timelineItemStarted(
                threadId: "thread_1",
                turnId: "turn_1",
                itemId: "item_file",
                label: "File change",
                detail: "update: README.md\n+hello"
            )
        )
    }

    func testDecodesApprovalResolvedWithoutDecision() throws {
        let json = """
        {
          "type": "host.event",
          "event": {
            "sequence": 2,
            "hostId": "host_1",
            "receivedAt": "2026-05-10T00:00:00Z",
            "event": {
              "type": "approval.resolved",
              "requestId": "approval_1"
            }
          }
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(RelayServerMessage.self, from: json)

        guard case .hostEvent(let cached) = message else {
            return XCTFail("Expected host.event")
        }
        XCTAssertEqual(cached.event, .approvalResolved(requestId: "approval_1", decision: nil))
    }

    func testDecodesRelayCacheGapError() throws {
        let json = """
        {
          "type": "relay.error",
          "code": "HOST_EVENT_CACHE_GAP",
          "message": "Host event cache dropped events through sequence 10; cannot replay after sequence 3"
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(RelayServerMessage.self, from: json)

        XCTAssertEqual(
            message,
            .error(
                code: "HOST_EVENT_CACHE_GAP",
                message: "Host event cache dropped events through sequence 10; cannot replay after sequence 3"
            )
        )
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
        projection.apply(.turnStatusChanged(threadId: "thread_1", turnId: "turn_1", status: .running))
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
            label: "pnpm test",
            detail: "read access: /repo"
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
        XCTAssertEqual(projection.timeline.first?.detail, "read access: /repo")
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

    func testBuildsLiveActivitySnapshotWithDeepLink() throws {
        var projection = projectionWithActiveTurn(status: .running)

        projection.apply(.transcriptItemRecorded(
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "item_assistant",
            role: .assistant,
            text: "Working on the Relay cache."
        ))

        let snapshot = try CodexLinkLiveActivitySnapshot.current(
            from: projection,
            selection: CodexLinkSessionSelection(
                hostId: "host_1",
                projectId: "project_1",
                threadId: "thread_1",
                activeTurnId: "turn_1"
            )
        )

        XCTAssertEqual(snapshot?.visibility, .active)
        XCTAssertEqual(snapshot?.state.hostName, "MacBook")
        XCTAssertEqual(snapshot?.state.projectName, "Codex Link")
        XCTAssertEqual(snapshot?.state.latestText, "Working on the Relay cache.")
        XCTAssertEqual(
            snapshot?.deepLinkURL.absoluteString,
            "codexlink://thread?hostId=host_1&projectId=project_1&threadId=thread_1&turnId=turn_1"
        )
    }

    func testParsesLiveActivityDeepLinkSelection() throws {
        let url = try CodexLinkDeepLink.openThreadURL(
            hostId: "host_1",
            projectId: "project_1",
            threadId: "thread_1",
            turnId: "turn_1"
        )

        let selection = CodexLinkDeepLink.selection(from: url)

        XCTAssertEqual(selection, CodexLinkSessionSelection(
            hostId: "host_1",
            projectId: "project_1",
            threadId: "thread_1",
            activeTurnId: "turn_1"
        ))
    }

    func testLiveActivitySnapshotMarksApprovalAsActive() throws {
        var projection = projectionWithActiveTurn(status: .running)
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

        let snapshot = try CodexLinkLiveActivitySnapshot.current(
            from: projection,
            selection: CodexLinkSessionSelection(
                hostId: "host_1",
                projectId: "project_1",
                threadId: "thread_1",
                activeTurnId: "turn_1"
            )
        )

        XCTAssertEqual(snapshot?.visibility, .active)
        XCTAssertEqual(snapshot?.state.status, .waitingForApproval)
        XCTAssertTrue(snapshot?.state.approvalRequired == true)
    }

    func testLiveActivitySnapshotMarksTerminalTurnsForEnding() throws {
        let projection = projectionWithActiveTurn(status: .failed)

        let snapshot = try CodexLinkLiveActivitySnapshot.current(
            from: projection,
            selection: CodexLinkSessionSelection(
                hostId: "host_1",
                projectId: "project_1",
                threadId: "thread_1",
                activeTurnId: "turn_1"
            )
        )

        XCTAssertEqual(snapshot?.visibility, .ending)
    }

    func testLiveActivitySnapshotRequiresVisibleSelectedEntities() throws {
        let snapshot = try CodexLinkLiveActivitySnapshot.current(
            from: CodexLinkProjection(),
            selection: CodexLinkSessionSelection(
                hostId: "host_1",
                projectId: "project_1",
                threadId: "thread_1",
                activeTurnId: "turn_1"
            )
        )

        XCTAssertNil(snapshot)
    }

    func testDiagnosticsDoNotEnterTranscriptOrTimeline() {
        var projection = CodexLinkProjection()

        projection.apply(.diagnosticReported(DiagnosticEvent(
            scope: "codex",
            severity: .warning,
            message: "MCP server failed to start"
        )))

        XCTAssertEqual(projection.diagnostics, [
            DiagnosticEvent(
                scope: "codex",
                severity: .warning,
                message: "MCP server failed to start"
            ),
        ])
        XCTAssertTrue(projection.transcript.isEmpty)
        XCTAssertTrue(projection.timeline.isEmpty)
    }

    func testDecodesDiagnosticEvent() throws {
        let json = """
        {
          "type": "diagnostic.reported",
          "diagnostic": {
            "scope": "codex",
            "severity": "warning",
            "message": "MCP server failed to start"
          }
        }
        """.data(using: .utf8)!

        let event = try JSONDecoder().decode(CodexLinkEvent.self, from: json)

        XCTAssertEqual(event, .diagnosticReported(DiagnosticEvent(
            scope: "codex",
            severity: .warning,
            message: "MCP server failed to start"
        )))
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

    func testActionEncoderIncludesRestoreSequenceInHostSubscription() throws {
        let encoder = CodexLinkRelayActionEncoder()
        let data = try encoder.encode(
            .selectHost(hostId: "host_1"),
            currentHostId: nil,
            afterSequence: 42
        )
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(object?["type"] as? String, "client.subscribeHost")
        XCTAssertEqual(object?["hostId"] as? String, "host_1")
        XCTAssertEqual(object?["afterSequence"] as? Int, 42)
    }

    func testActionEncoderTreatsPairingAsLocalOnly() throws {
        let encoder = CodexLinkRelayActionEncoder()

        XCTAssertThrowsError(try encoder.encode(
            .pairHost(pairingCode: "ABCD-EF12"),
            currentHostId: nil
        )) { error in
            XCTAssertEqual(
                error as? CodexLinkRelayActionEncodingError,
                .localOnlyAction("pairHost")
            )
        }
    }

    func testActionEncoderTreatsDeviceRevocationAsLocalOnly() throws {
        let encoder = CodexLinkRelayActionEncoder()

        XCTAssertThrowsError(try encoder.encode(
            .revokeDeviceSession,
            currentHostId: nil
        )) { error in
            XCTAssertEqual(
                error as? CodexLinkRelayActionEncodingError,
                .localOnlyAction("revokeDeviceSession")
            )
        }
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
        projection.apply(.turnStatusChanged(threadId: "thread_1", turnId: "turn_1", status: .running))

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

    func testStartupRestoreWithoutBookmarkStartsAtHostPicker() async throws {
        let store = InMemoryBookmarkStore()
        let relay = MockVisibleSessionRestorer()
        let startup = CodexLinkStartupRestorer(bookmarkStore: store, relayClient: relay)

        let result = try await startup.restore()

        XCTAssertEqual(result.selection, CodexLinkSessionSelection())
        XCTAssertNil(result.bookmark)
        XCTAssertFalse(result.restoredFromRelay)
        XCTAssertEqual(relay.restoreCallCount, 0)
    }

    func testStartupRestoreLoadsBookmarkFromRelayAndSavesUpdatedBookmark() async throws {
        let originalBookmark = CodexLinkSessionBookmark(
            hostId: "host_1",
            projectId: "project_1",
            threadId: "thread_1",
            activeTurnId: "turn_1",
            lastRelaySequence: 3
        )
        let updatedBookmark = CodexLinkSessionBookmark(
            hostId: "host_1",
            projectId: "project_1",
            threadId: "thread_1",
            activeTurnId: "turn_1",
            lastRelaySequence: 9
        )
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
        projection.apply(.turnStatusChanged(threadId: "thread_1", turnId: "turn_1", status: .running))

        let store = InMemoryBookmarkStore(bookmark: originalBookmark)
        let relay = MockVisibleSessionRestorer(result: CodexLinkWebSocketRestoreResult(
            projection: projection,
            selection: CodexLinkSessionSelection(
                hostId: "host_1",
                projectId: "project_1",
                threadId: "thread_1",
                activeTurnId: "turn_1"
            ),
            bookmark: updatedBookmark
        ))
        let startup = CodexLinkStartupRestorer(bookmarkStore: store, relayClient: relay)

        let result = try await startup.restore()

        XCTAssertEqual(relay.requestedBookmark, originalBookmark)
        XCTAssertEqual(result.selection.hostId, "host_1")
        XCTAssertEqual(result.selection.threadId, "thread_1")
        XCTAssertEqual(result.bookmark, updatedBookmark)
        XCTAssertEqual(store.savedBookmark, updatedBookmark)
        XCTAssertTrue(result.restoredFromRelay)
    }

    @MainActor
    func testAppViewModelRegistersConnectsReceivesAndSendsActions() async throws {
        let deviceSession = CodexLinkDeviceSession(
            relayUrl: "http://relay.test",
            userId: "usr_1",
            deviceId: "dev_1",
            deviceToken: "device_token_1",
            displayName: "owner",
            deviceName: "Owner iPhone"
        )
        let deviceStore = InMemoryDeviceSessionStore()
        let deviceClient = MockDeviceSessionClient(result: deviceSession)
        let bookmarkStore = InMemoryBookmarkStore()
        let relayClient = MockAppRelayClient(messages: [
            .ready(role: "client", connectionId: "conn_1"),
            .hostEvent(CachedRelayEvent(
                sequence: 1,
                hostId: "host_1",
                event: .hostOnline(Host(
                    id: "host_1",
                    ownerUserId: "usr_1",
                    deviceId: "dev_host",
                    name: "MacBook",
                    platform: "macos",
                    status: .online
                )),
                receivedAt: "2026-05-10T00:00:00Z"
            )),
        ])
        let model = CodexLinkAppViewModel(
            configuration: CodexLinkAppRuntimeConfiguration(
                relayURL: URL(string: "http://relay.test")!,
                displayName: "owner",
                deviceName: "Owner iPhone"
            ),
            deviceSessionStore: deviceStore,
            bookmarkStore: bookmarkStore,
            deviceSessionClient: deviceClient,
            relayClientFactory: { _ in relayClient }
        )

        model.start()
        try await waitUntil {
            model.projection.hosts["host_1"]?.status == .online
        }
        model.updateSelection(CodexLinkSessionSelection(hostId: "host_1"))
        model.handle(.selectHost(hostId: "host_1"))
        try await waitUntil {
            relayClient.sentActions.contains(.selectHost(hostId: "host_1"))
        }

        XCTAssertEqual(deviceClient.registerCallCount, 1)
        XCTAssertEqual(deviceStore.savedDeviceSession, deviceSession)
        XCTAssertTrue(relayClient.didConnect)
        XCTAssertEqual(bookmarkStore.bookmark?.hostId, "host_1")

        model.stop()
        XCTAssertTrue(relayClient.didDisconnect)
    }

    @MainActor
    func testAppViewModelSurfacesRelayCacheGapAsConnectionFailure() async throws {
        let deviceSession = CodexLinkDeviceSession(
            relayUrl: "http://relay.test",
            userId: "usr_1",
            deviceId: "dev_1",
            deviceToken: "device_token_1",
            displayName: "owner",
            deviceName: "Owner iPhone"
        )
        let relayClient = MockAppRelayClient(messages: [
            .ready(role: "client", connectionId: "conn_1"),
            .error(
                code: "HOST_EVENT_CACHE_GAP",
                message: "Host event cache dropped events through sequence 10; cannot replay after sequence 3"
            ),
        ])
        let model = CodexLinkAppViewModel(
            configuration: CodexLinkAppRuntimeConfiguration(
                relayURL: URL(string: "http://relay.test")!,
                displayName: "owner",
                deviceName: "Owner iPhone"
            ),
            deviceSessionStore: InMemoryDeviceSessionStore(deviceSession: deviceSession),
            bookmarkStore: InMemoryBookmarkStore(),
            relayClientFactory: { _ in relayClient }
        )

        model.start()
        try await waitUntil {
            model.connectionState == .failed
        }

        XCTAssertEqual(
            model.lastErrorMessage,
            "Relay error HOST_EVENT_CACHE_GAP: Host event cache dropped events through sequence 10; cannot replay after sequence 3"
        )
        XCTAssertEqual(model.projection.latestError, model.lastErrorMessage)

        model.stop()
    }

    @MainActor
    func testAppViewModelPairsHostAndSubscribes() async throws {
        let deviceSession = CodexLinkDeviceSession(
            relayUrl: "http://relay.test",
            userId: "usr_1",
            deviceId: "dev_1",
            deviceToken: "device_token_1",
            displayName: "owner",
            deviceName: "Owner iPhone"
        )
        let deviceClient = MockDeviceSessionClient(
            result: deviceSession,
            pairingResult: CodexLinkDevicePairingResult(
                relayUrl: "http://relay.test",
                userId: "usr_1",
                deviceId: "dev_1",
                hostId: "host_1",
                hostName: "MacBook",
                role: "operator"
            )
        )
        let relayClient = MockAppRelayClient(messages: [
            .ready(role: "client", connectionId: "conn_1"),
        ])
        let bookmarkStore = InMemoryBookmarkStore()
        let model = CodexLinkAppViewModel(
            configuration: CodexLinkAppRuntimeConfiguration(
                relayURL: URL(string: "http://relay.test")!,
                displayName: "owner",
                deviceName: "Owner iPhone"
            ),
            deviceSessionStore: InMemoryDeviceSessionStore(deviceSession: deviceSession),
            bookmarkStore: bookmarkStore,
            deviceSessionClient: deviceClient,
            relayClientFactory: { _ in relayClient }
        )

        model.start()
        try await waitUntil {
            relayClient.didConnect
        }
        model.handle(.pairHost(pairingCode: "ABCD-EF12"))
        try await waitUntil {
            relayClient.sentActions.contains(.selectHost(hostId: "host_1"))
        }
        relayClient.messages.append(.hostEvent(CachedRelayEvent(
            sequence: 1,
            hostId: "host_1",
            event: .projectListUpdated(
                hostId: "host_1",
                projects: [ProjectRef(
                    id: "project_1",
                    hostId: "host_1",
                    name: "Codex Link",
                    pathLabel: "/repo"
                )]
            ),
            receivedAt: "2026-05-10T00:00:00Z"
        )))
        try await waitUntil {
            model.selection.projectId == "project_1"
        }
        relayClient.messages.append(.hostEvent(CachedRelayEvent(
            sequence: 2,
            hostId: "host_1",
            event: .threadStarted(ThreadRef(
                id: "thread_1",
                projectId: "project_1",
                title: "First prompt"
            )),
            receivedAt: "2026-05-10T00:00:01Z"
        )))
        relayClient.messages.append(.hostEvent(CachedRelayEvent(
            sequence: 3,
            hostId: "host_1",
            event: .turnStatusChanged(
                threadId: "thread_1",
                turnId: "turn_1",
                status: .running
            ),
            receivedAt: "2026-05-10T00:00:02Z"
        )))
        try await waitUntil {
            model.selection.threadId == "thread_1" && model.selection.activeTurnId == "turn_1"
        }

        XCTAssertEqual(deviceClient.pairingCode, "ABCD-EF12")
        XCTAssertEqual(deviceClient.pairingDeviceToken, "device_token_1")
        XCTAssertEqual(model.selection.hostId, "host_1")
        XCTAssertEqual(bookmarkStore.bookmark?.projectId, "project_1")
        XCTAssertEqual(bookmarkStore.bookmark?.threadId, "thread_1")
        XCTAssertEqual(bookmarkStore.bookmark?.activeTurnId, "turn_1")

        model.stop()
    }

    @MainActor
    func testAppViewModelRevokesDeviceSessionAndClearsLocalState() async throws {
        let deviceSession = CodexLinkDeviceSession(
            relayUrl: "http://relay.test",
            userId: "usr_1",
            deviceId: "dev_1",
            deviceToken: "device_token_1",
            displayName: "owner",
            deviceName: "Owner iPhone"
        )
        let deviceClient = MockDeviceSessionClient(
            result: deviceSession,
            revocationResult: CodexLinkDeviceRevocationResult(
                relayUrl: "http://relay.test",
                userId: "usr_1",
                deviceId: "dev_1",
                revokedAt: "2026-05-10T00:00:00.000Z"
            )
        )
        let deviceStore = InMemoryDeviceSessionStore(deviceSession: deviceSession)
        let bookmarkStore = InMemoryBookmarkStore(bookmark: CodexLinkSessionBookmark(
            hostId: "host_1",
            projectId: "project_1",
            threadId: "thread_1",
            activeTurnId: "turn_1",
            lastRelaySequence: 8
        ))
        let relayClient = MockAppRelayClient(messages: [
            .ready(role: "client", connectionId: "conn_1"),
        ])
        let model = CodexLinkAppViewModel(
            configuration: CodexLinkAppRuntimeConfiguration(
                relayURL: URL(string: "http://relay.test")!,
                displayName: "owner",
                deviceName: "Owner iPhone"
            ),
            selection: CodexLinkSessionSelection(
                hostId: "host_1",
                projectId: "project_1",
                threadId: "thread_1",
                activeTurnId: "turn_1"
            ),
            deviceSessionStore: deviceStore,
            bookmarkStore: bookmarkStore,
            deviceSessionClient: deviceClient,
            relayClientFactory: { _ in relayClient }
        )

        model.start()
        try await waitUntil {
            relayClient.didConnect
        }
        model.handle(.revokeDeviceSession)
        try await waitUntil {
            deviceClient.revokedDeviceId == "dev_1" && model.deviceSession == nil
        }

        XCTAssertEqual(deviceClient.revokedUserId, "usr_1")
        XCTAssertEqual(deviceClient.revocationDeviceToken, "device_token_1")
        XCTAssertTrue(relayClient.didDisconnect)
        XCTAssertNil(deviceStore.deviceSession)
        XCTAssertNil(bookmarkStore.bookmark)
        XCTAssertEqual(model.selection, CodexLinkSessionSelection())
        XCTAssertEqual(model.connectionState, .disconnected)
    }
}

private func projectionWithActiveTurn(status: TurnStatus) -> CodexLinkProjection {
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
    projection.apply(.turnStatusChanged(threadId: "thread_1", turnId: "turn_1", status: status))
    return projection
}

private final class InMemoryBookmarkStore: CodexLinkBookmarkStoring, @unchecked Sendable {
    var bookmark: CodexLinkSessionBookmark?
    var savedBookmark: CodexLinkSessionBookmark?

    init(bookmark: CodexLinkSessionBookmark? = nil) {
        self.bookmark = bookmark
    }

    func loadBookmark() throws -> CodexLinkSessionBookmark? {
        bookmark
    }

    func saveBookmark(_ bookmark: CodexLinkSessionBookmark) throws {
        savedBookmark = bookmark
        self.bookmark = bookmark
    }

    func clearBookmark() throws {
        bookmark = nil
    }
}

private final class MockVisibleSessionRestorer: CodexLinkVisibleSessionRestoring, @unchecked Sendable {
    var result: CodexLinkWebSocketRestoreResult?
    var requestedBookmark: CodexLinkSessionBookmark?
    var restoreCallCount = 0

    init(result: CodexLinkWebSocketRestoreResult? = nil) {
        self.result = result
    }

    func restoreVisibleSession(
        from bookmark: CodexLinkSessionBookmark,
        startingProjection: CodexLinkProjection
    ) async throws -> CodexLinkWebSocketRestoreResult {
        restoreCallCount += 1
        requestedBookmark = bookmark
        if let result {
            return result
        }
        return CodexLinkWebSocketRestoreResult(
            projection: startingProjection,
            selection: CodexLinkSessionSelection(),
            bookmark: bookmark
        )
    }
}

private final class InMemoryDeviceSessionStore: CodexLinkDeviceSessionStoring, @unchecked Sendable {
    var deviceSession: CodexLinkDeviceSession?
    var savedDeviceSession: CodexLinkDeviceSession?

    init(deviceSession: CodexLinkDeviceSession? = nil) {
        self.deviceSession = deviceSession
    }

    func loadDeviceSession() throws -> CodexLinkDeviceSession? {
        deviceSession
    }

    func saveDeviceSession(_ deviceSession: CodexLinkDeviceSession) throws {
        savedDeviceSession = deviceSession
        self.deviceSession = deviceSession
    }

    func clearDeviceSession() throws {
        deviceSession = nil
    }
}

private final class MockDeviceSessionClient: CodexLinkDeviceSessionManaging, @unchecked Sendable {
    let result: CodexLinkDeviceSession
    let pairingResult: CodexLinkDevicePairingResult?
    let revocationResult: CodexLinkDeviceRevocationResult?
    var registerCallCount = 0
    var pairingCode: String?
    var pairingDeviceToken: String?
    var revokedUserId: String?
    var revokedDeviceId: String?
    var revocationDeviceToken: String?

    init(
        result: CodexLinkDeviceSession,
        pairingResult: CodexLinkDevicePairingResult? = nil,
        revocationResult: CodexLinkDeviceRevocationResult? = nil
    ) {
        self.result = result
        self.pairingResult = pairingResult
        self.revocationResult = revocationResult
    }

    func registerPlaceholderDevice(
        displayName: String,
        deviceName: String
    ) async throws -> CodexLinkDeviceSession {
        registerCallCount += 1
        return result
    }

    func pairHost(
        pairingCode: String,
        userId: String,
        deviceId: String,
        deviceToken: String
    ) async throws -> CodexLinkDevicePairingResult {
        self.pairingCode = pairingCode
        pairingDeviceToken = deviceToken
        if let pairingResult {
            return pairingResult
        }
        return CodexLinkDevicePairingResult(
            relayUrl: result.relayUrl,
            userId: result.userId,
            deviceId: result.deviceId,
            hostId: "host_1",
            hostName: "MacBook",
            role: "operator"
        )
    }

    func revokeDevice(
        userId: String,
        deviceId: String,
        deviceToken: String
    ) async throws -> CodexLinkDeviceRevocationResult {
        revokedUserId = userId
        revokedDeviceId = deviceId
        revocationDeviceToken = deviceToken
        if let revocationResult {
            return revocationResult
        }
        return CodexLinkDeviceRevocationResult(
            relayUrl: result.relayUrl,
            userId: userId,
            deviceId: deviceId,
            revokedAt: "2026-05-10T00:00:00.000Z"
        )
    }
}

private final class MockAppRelayClient: CodexLinkAppRelayClient, @unchecked Sendable {
    var messages: [RelayServerMessage]
    var sentActions: [CodexLinkUIAction] = []
    var didConnect = false
    var didDisconnect = false

    init(messages: [RelayServerMessage] = []) {
        self.messages = messages
    }

    func connect() throws {
        didConnect = true
    }

    func disconnect() {
        didDisconnect = true
    }

    func send(
        _ action: CodexLinkUIAction,
        currentHostId: String?,
        afterSequence: Int?
    ) async throws {
        sentActions.append(action)
    }

    func receive() async throws -> RelayServerMessage {
        while messages.isEmpty {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        return messages.removeFirst()
    }

    func restoreVisibleSession(
        from bookmark: CodexLinkSessionBookmark,
        startingProjection: CodexLinkProjection
    ) async throws -> CodexLinkWebSocketRestoreResult {
        CodexLinkWebSocketRestoreResult(
            projection: startingProjection,
            selection: CodexLinkSessionSelection(),
            bookmark: bookmark
        )
    }
}

@MainActor
private func waitUntil(
    timeoutNanoseconds: UInt64 = 1_000_000_000,
    condition: @escaping () -> Bool
) async throws {
    let start = ContinuousClock.now
    while !condition() {
        try await Task.sleep(nanoseconds: 10_000_000)
        if start.duration(to: ContinuousClock.now) > .nanoseconds(Int64(timeoutNanoseconds)) {
            XCTFail("Timed out waiting for condition")
            return
        }
    }
}
