import Combine
import Foundation
import os

enum CodexLinkAppLogger {
    static let lifecycle = Logger(subsystem: "dev.codexlink.ios", category: "lifecycle")
    static let relay = Logger(subsystem: "dev.codexlink.ios", category: "relay")
}

public struct CodexLinkAppRuntimeConfiguration: Equatable, Sendable {
    public let relayURL: URL
    public let displayName: String
    public let deviceName: String

    public init(relayURL: URL, displayName: String, deviceName: String) {
        self.relayURL = relayURL
        self.displayName = displayName
        self.deviceName = deviceName
    }
}

public enum CodexLinkAppLifecycleError: Error, Equatable, Sendable {
    case missingConfiguration(String)
    case missingRelayClient
    case invalidRelayURL(String)
}

public protocol CodexLinkAppRelayClient: AnyObject, CodexLinkVisibleSessionRestoring, Sendable {
    func connect() throws
    func disconnect()
    func send(_ action: CodexLinkUIAction, currentHostId: String?, afterSequence: Int?) async throws
    func receive() async throws -> RelayServerMessage
}

public typealias CodexLinkAppRelayClientFactory = (CodexLinkDeviceSession) throws -> any CodexLinkAppRelayClient

extension CodexLinkRelayWebSocketClient: CodexLinkAppRelayClient {}

@MainActor
public final class CodexLinkAppViewModel: ObservableObject {
    @Published public private(set) var projection: CodexLinkProjection
    @Published public var selection: CodexLinkSessionSelection {
        didSet {
            persistSelection(previousSelection: oldValue)
        }
    }
    @Published public private(set) var connectionState: CodexLinkConnectionState
    @Published public private(set) var deviceSession: CodexLinkDeviceSession?
    @Published public private(set) var lastErrorMessage: String?

    private let configuration: CodexLinkAppRuntimeConfiguration?
    private let configurationErrorMessage: String?
    private let deviceSessionStore: any CodexLinkDeviceSessionStoring
    private let bookmarkStore: any CodexLinkBookmarkStoring
    private let deviceSessionClient: (any CodexLinkDeviceSessionManaging)?
    private let relayClientFactory: CodexLinkAppRelayClientFactory?

    private var relayClient: (any CodexLinkAppRelayClient)?
    private var runTask: Task<Void, Never>?
    private var lastRelaySequence: Int?

    public init(
        configuration: CodexLinkAppRuntimeConfiguration,
        projection: CodexLinkProjection = CodexLinkProjection(),
        selection: CodexLinkSessionSelection = CodexLinkSessionSelection(),
        connectionState: CodexLinkConnectionState = .disconnected,
        deviceSessionStore: any CodexLinkDeviceSessionStoring = CodexLinkKeychainDeviceSessionStore(),
        bookmarkStore: any CodexLinkBookmarkStoring = CodexLinkUserDefaultsBookmarkStore(),
        deviceSessionClient: (any CodexLinkDeviceSessionManaging)? = nil,
        relayClientFactory: CodexLinkAppRelayClientFactory? = nil
    ) {
        self.configuration = configuration
        self.configurationErrorMessage = nil
        self.projection = projection
        self.selection = selection
        self.connectionState = connectionState
        self.deviceSessionStore = deviceSessionStore
        self.bookmarkStore = bookmarkStore
        self.deviceSessionClient = deviceSessionClient
            ?? CodexLinkDeviceSessionClient(relayURL: configuration.relayURL)
        self.relayClientFactory = relayClientFactory ?? Self.defaultRelayClientFactory
    }

    public init(
        configurationErrorMessage: String,
        projection: CodexLinkProjection = CodexLinkProjection(),
        selection: CodexLinkSessionSelection = CodexLinkSessionSelection(),
        deviceSessionStore: any CodexLinkDeviceSessionStoring = CodexLinkKeychainDeviceSessionStore(),
        bookmarkStore: any CodexLinkBookmarkStoring = CodexLinkUserDefaultsBookmarkStore()
    ) {
        self.configuration = nil
        self.configurationErrorMessage = configurationErrorMessage
        self.projection = projection
        self.selection = selection
        self.connectionState = .disconnected
        self.deviceSessionStore = deviceSessionStore
        self.bookmarkStore = bookmarkStore
        self.deviceSessionClient = nil
        self.relayClientFactory = nil
    }

    deinit {
        runTask?.cancel()
        relayClient?.disconnect()
    }

    public func start() {
        guard runTask == nil else {
            return
        }
        runTask = Task { [weak self] in
            await self?.run()
        }
    }

    public func stop() {
        runTask?.cancel()
        runTask = nil
        relayClient?.disconnect()
        relayClient = nil
        connectionState = .disconnected
    }

    public func updateSelection(_ newSelection: CodexLinkSessionSelection) {
        selection = newSelection
    }

    public func openDeepLink(_ url: URL) {
        if let pairingPayload = CodexLinkDeepLink.pairing(from: url) {
            handle(.pairHost(pairingCode: pairingPayload.pairingCode))
            return
        }
        guard let deepLinkedSelection = CodexLinkDeepLink.selection(from: url) else {
            return
        }
        selection = deepLinkedSelection
        guard relayClient != nil else {
            return
        }
        if let hostId = deepLinkedSelection.hostId {
            handle(.selectHost(hostId: hostId))
        }
        if let projectId = deepLinkedSelection.projectId,
           let threadId = deepLinkedSelection.threadId {
            handle(.restoreThread(projectId: projectId, threadId: threadId))
        }
    }

    public func handle(_ action: CodexLinkUIAction) {
        CodexLinkAppLogger.lifecycle.info("handle action: \(String(describing: action), privacy: .public)")
        switch action {
        case .pairHost(let pairingCode):
            Task { [weak self] in
                await self?.pairHost(pairingCode: pairingCode)
            }
        case .revokeDeviceSession:
            Task { [weak self] in
                await self?.revokeDeviceSession()
            }
        case .showHostSwitcher:
            selection = CodexLinkSessionSelection()
        case .showInspector:
            break
        case .unsupportedOperation(let reason):
            CodexLinkAppLogger.lifecycle.error("unsupported operation: \(reason, privacy: .public)")
            recordError(reason)
        case .dismissError:
            lastErrorMessage = nil
            projection.clearLatestError()
        default:
            Task { [weak self] in
                await self?.send(action)
            }
        }
    }

    private func run() async {
        defer {
            runTask = nil
        }

        var attempt = 0
        while !Task.isCancelled {
            do {
                try await runOnce(isFirstAttempt: attempt == 0)
                attempt = 0
            } catch is CancellationError {
                connectionState = .disconnected
                return
            } catch CodexLinkAppLifecycleError.missingConfiguration(let message) {
                CodexLinkAppLogger.lifecycle.error("run aborted: \(message, privacy: .public)")
                recordError(message)
                connectionState = .failed
                return
            } catch CodexLinkAppLifecycleError.missingRelayClient {
                CodexLinkAppLogger.lifecycle.error("run aborted: missing relay client factory")
                recordError("CodexLink Relay client is missing.")
                connectionState = .failed
                return
            } catch CodexLinkRelayClientError.relayError(let code, let message)
                where code == "NOT_FOUND"
                && (message.contains("User not found") || message.contains("Device not found")) {
                // Relay state was reset (e.g. container restart without
                // persistence, or persistence wiped) but iPhone still has
                // a stale device session for an unknown user/device.
                // Drop local state so the app returns to the pair screen
                // with a fresh placeholder session on next launch / restart.
                CodexLinkAppLogger.relay.error("Relay returned NOT_FOUND for our session (\(message, privacy: .public)); clearing local session state and bookmark")
                recordError("Codex Link Relay no longer recognizes this device. Re-pair from the Mac.")
                clearLocalSessionState()
                return
            } catch {
                attempt += 1
                let delaySeconds = min(30, attempt * 2)
                CodexLinkAppLogger.relay.error("run failed (attempt \(attempt)): \(String(describing: error), privacy: .public); retrying in \(delaySeconds)s")
                recordError(describe(error))
                connectionState = .failed
                relayClient?.disconnect()
                relayClient = nil
                do {
                    try await Task.sleep(for: .seconds(delaySeconds))
                } catch {
                    return
                }
            }
        }
    }

    private func runOnce(isFirstAttempt: Bool) async throws {
        guard let configuration else {
            throw CodexLinkAppLifecycleError.missingConfiguration(
                configurationErrorMessage ?? "CodexLink app configuration is missing."
            )
        }
        connectionState = .connecting
        let deviceSession = try await loadOrRegisterDeviceSession(configuration: configuration)
        self.deviceSession = deviceSession

        guard let relayClientFactory else {
            throw CodexLinkAppLifecycleError.missingRelayClient
        }
        let client = try relayClientFactory(deviceSession)
        relayClient = client
        try client.connect()

        if isFirstAttempt {
            connectionState = .restoring
            let startup = CodexLinkStartupRestorer(
                bookmarkStore: bookmarkStore,
                relayClient: client
            )
            let restored = try await startup.restore(startingProjection: projection)
            projection = restored.projection
            selection = restored.selection
            lastRelaySequence = nil
            persistSelection(previousSelection: selection)
            connectionState = restored.restoredFromRelay ? .restored : .connected
        } else if let hostId = selection.hostId {
            CodexLinkAppLogger.lifecycle.info("reconnect: resubscribing host \(hostId, privacy: .public) afterSequence=\(self.lastRelaySequence ?? -1)")
            try await client.send(
                .selectHost(hostId: hostId),
                currentHostId: hostId,
                afterSequence: lastRelaySequence
            )
            connectionState = .connected
        } else {
            connectionState = .connected
        }

        if let projectId = selection.projectId {
            CodexLinkAppLogger.lifecycle.info("\(isFirstAttempt ? "startup" : "reconnect", privacy: .public): requesting thread list for project \(projectId, privacy: .public)")
            do {
                try await client.send(
                    .selectProject(projectId: projectId),
                    currentHostId: selection.hostId,
                    afterSequence: nil
                )
            } catch {
                CodexLinkAppLogger.relay.error("failed to request thread list: \(String(describing: error), privacy: .public)")
            }
        }

        try await receiveLoop(client: client)
    }

    private func loadOrRegisterDeviceSession(
        configuration: CodexLinkAppRuntimeConfiguration
    ) async throws -> CodexLinkDeviceSession {
        if let stored = try deviceSessionStore.loadDeviceSession() {
            if stored.relayUrl == configuration.relayURL.absoluteString {
                if let revalidated = await revalidateDeviceSession(stored) {
                    if revalidated.deviceToken != stored.deviceToken {
                        try? deviceSessionStore.saveDeviceSession(revalidated)
                    }
                    return revalidated
                }
                try? bookmarkStore.clearBookmark()
            }
            try deviceSessionStore.clearDeviceSession()
        }
        guard let deviceSessionClient else {
            throw CodexLinkAppLifecycleError.missingConfiguration(
                "CodexLink device session client is missing."
            )
        }
        let registered = try await deviceSessionClient.registerPlaceholderDevice(
            displayName: configuration.displayName,
            deviceName: configuration.deviceName
        )
        try deviceSessionStore.saveDeviceSession(registered)
        return registered
    }

    private func revalidateDeviceSession(_ session: CodexLinkDeviceSession) async -> CodexLinkDeviceSession? {
        guard let deviceSessionClient else { return session }
        do {
            let rotated = try await deviceSessionClient.rotateDeviceCredential(
                userId: session.userId,
                deviceId: session.deviceId,
                deviceToken: session.deviceToken
            )
            return CodexLinkDeviceSession(
                relayUrl: rotated.relayUrl,
                userId: rotated.userId,
                deviceId: rotated.deviceId,
                deviceToken: rotated.deviceToken,
                deviceTokenExpiresAt: rotated.deviceTokenExpiresAt,
                displayName: session.displayName,
                deviceName: session.deviceName
            )
        } catch CodexLinkDeviceSessionClientError.invalidHTTPStatus(let status) where status == 401 {
            return nil
        } catch {
            return session
        }
    }

    static let deviceCredentialRotationThreshold: TimeInterval = 7 * 24 * 60 * 60

    private nonisolated func parseISO8601(_ value: String) -> Date? {
        let withMillis = ISO8601DateFormatter()
        withMillis.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withMillis.date(from: value) {
            return date
        }
        let withoutMillis = ISO8601DateFormatter()
        withoutMillis.formatOptions = [.withInternetDateTime]
        return withoutMillis.date(from: value)
    }

    func maybeRotateDeviceCredential(
        _ session: CodexLinkDeviceSession,
        now: Date
    ) async -> CodexLinkDeviceSession {
        guard let deviceSessionClient,
              let expiryString = session.deviceTokenExpiresAt,
              let expiresAt = parseISO8601(expiryString)
        else {
            return session
        }
        let remaining = expiresAt.timeIntervalSince(now)
        guard remaining < Self.deviceCredentialRotationThreshold else {
            return session
        }
        do {
            let rotated = try await deviceSessionClient.rotateDeviceCredential(
                userId: session.userId,
                deviceId: session.deviceId,
                deviceToken: session.deviceToken
            )
            let refreshed = CodexLinkDeviceSession(
                relayUrl: rotated.relayUrl,
                userId: rotated.userId,
                deviceId: rotated.deviceId,
                deviceToken: rotated.deviceToken,
                deviceTokenExpiresAt: rotated.deviceTokenExpiresAt,
                displayName: session.displayName,
                deviceName: session.deviceName
            )
            try? deviceSessionStore.saveDeviceSession(refreshed)
            return refreshed
        } catch {
            return session
        }
    }

    private func pairHost(pairingCode: String) async {
        let code = pairingCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else {
            return
        }
        guard let deviceSession else {
            recordError("Codex Link device session is not ready.")
            return
        }
        guard let deviceSessionClient else {
            recordError("Codex Link device session client is missing.")
            return
        }

        do {
            let result = try await deviceSessionClient.pairHost(
                pairingCode: code,
                userId: deviceSession.userId,
                deviceId: deviceSession.deviceId,
                deviceToken: deviceSession.deviceToken
            )
            selection = CodexLinkSessionSelection(hostId: result.hostId)
            if let relayClient {
                try await relayClient.send(
                    .selectHost(hostId: result.hostId),
                    currentHostId: result.hostId,
                    afterSequence: nil
                )
            }
        } catch {
            recordError(describe(error))
            connectionState = .failed
        }
    }

    private func revokeDeviceSession() async {
        guard let deviceSession else {
            clearLocalSessionState()
            return
        }
        guard let deviceSessionClient else {
            recordError("Codex Link device session client is missing.")
            return
        }

        do {
            _ = try await deviceSessionClient.revokeDevice(
                userId: deviceSession.userId,
                deviceId: deviceSession.deviceId,
                deviceToken: deviceSession.deviceToken
            )
            clearLocalSessionState()
        } catch {
            recordError(describe(error))
            connectionState = .failed
        }
    }

    private func clearLocalSessionState() {
        stop()
        projection = CodexLinkProjection()
        selection = CodexLinkSessionSelection()
        deviceSession = nil
        lastRelaySequence = nil
        lastErrorMessage = nil
        connectionState = .disconnected
        do {
            try deviceSessionStore.clearDeviceSession()
            try bookmarkStore.clearBookmark()
        } catch {
            recordError(describe(error))
        }
    }

    private func receiveLoop(client: any CodexLinkAppRelayClient) async throws {
        while !Task.isCancelled {
            let message = try await client.receive()
            try handleRelayMessage(message)
        }
    }

    private func handleRelayMessage(_ message: RelayServerMessage) throws {
        switch message {
        case .ready:
            if connectionState != .restored {
                connectionState = .connected
            }
        case .hostEvent(let cached):
            projection.apply(cached.event)
            lastRelaySequence = max(lastRelaySequence ?? 0, cached.sequence)
            selectDefaultProjectIfNeeded(for: cached.hostId)
            selectActiveTurnIfNeeded(from: cached.event, hostId: cached.hostId)
            persistSelection(previousSelection: selection)
        case .hostSubscriptionReady(_, _, let latestSequence):
            lastRelaySequence = max(lastRelaySequence ?? 0, latestSequence)
            if connectionState != .failed {
                connectionState = .connected
            }
            // Connection is healthy again — drop any stale error banner
            // (401 / NOT_FOUND / transient disconnect) so the UI doesn't
            // keep showing a red strip that doesn't reflect current state.
            lastErrorMessage = nil
            projection.clearLatestError()
            persistSelection(previousSelection: selection)
            if let projectId = selection.projectId {
                CodexLinkAppLogger.lifecycle.info("subscription ready; refreshing thread list for project \(projectId, privacy: .public)")
                Task { [weak self] in
                    await self?.send(.selectProject(projectId: projectId))
                }
            } else {
                CodexLinkAppLogger.lifecycle.info("subscription ready but projectId is nil; waiting for project list")
            }
        case .error(let code, let message):
            throw CodexLinkRelayClientError.relayError(code: code, message: message)
        case .hostMessage:
            throw CodexLinkRelayClientError.unsupportedWebSocketMessage
        }
    }

    private func selectDefaultProjectIfNeeded(for hostId: String) {
        guard selection.hostId == hostId, selection.projectId == nil else {
            return
        }
        guard let project = projection.projectsByHost[hostId]?.first else {
            return
        }
        selection.projectId = project.id
        CodexLinkAppLogger.lifecycle.info("auto-selected default project \(project.id, privacy: .public); requesting thread list")
        Task { [weak self] in
            await self?.send(.selectProject(projectId: project.id))
        }
    }

    private func selectActiveTurnIfNeeded(from event: CodexLinkEvent, hostId: String) {
        guard selection.hostId == hostId else {
            return
        }

        let hint: (threadId: String, turnId: String)
        switch event {
        case .turnStatusChanged(let threadId, let turnId, _):
            guard let threadId else {
                return
            }
            hint = (threadId, turnId)
        case .assistantDelta(let threadId, let turnId, _),
             .assistantFinal(let threadId, let turnId, _, _),
             .transcriptItemRecorded(let threadId, let turnId, _, _, _),
             .timelineItemStarted(let threadId, let turnId, _, _, _),
             .timelineItemCompleted(let threadId, let turnId, _, _):
            hint = (threadId, turnId)
        case .approvalRequested(let request):
            hint = (request.threadId, request.turnId)
        default:
            return
        }

        guard let thread = projection.threads[hint.threadId] else {
            return
        }
        if selection.projectId == nil {
            selection.projectId = thread.projectId
        }
        guard selection.projectId == thread.projectId else {
            return
        }
        if selection.threadId == nil {
            selection.threadId = hint.threadId
        }
        guard selection.threadId == hint.threadId else {
            return
        }
        selection.activeTurnId = hint.turnId
    }

    private func send(_ action: CodexLinkUIAction) async {
        guard let relayClient else {
            CodexLinkAppLogger.relay.error("send aborted: relayClient is nil")
            recordError("Relay WebSocket is not connected.")
            connectionState = .failed
            return
        }
        do {
            let afterSequence: Int?
            if case .selectHost = action {
                afterSequence = lastRelaySequence
            } else {
                afterSequence = nil
            }
            CodexLinkAppLogger.relay.info("dispatching to relay: \(String(describing: action), privacy: .public), currentHostId=\(self.selection.hostId ?? "nil", privacy: .public)")
            try await relayClient.send(
                action,
                currentHostId: selection.hostId,
                afterSequence: afterSequence
            )
            CodexLinkAppLogger.relay.info("relay send completed")
        } catch CodexLinkRelayClientError.localOnlyAction(let name) {
            CodexLinkAppLogger.relay.error("local-only action reached binding: \(name, privacy: .public)")
            recordError("Local-only action reached Relay binding: \(name)")
        } catch {
            CodexLinkAppLogger.relay.error("relay send failed: \(String(describing: error), privacy: .public)")
            recordError(describe(error))
            connectionState = .failed
        }
    }

    private func persistSelection(previousSelection: CodexLinkSessionSelection) {
        if previousSelection.hostId != selection.hostId {
            lastRelaySequence = nil
        }
        do {
            let bookmark = CodexLinkSessionRestore.bookmark(
                from: selection,
                lastRelaySequence: lastRelaySequence
            )
            try bookmarkStore.saveBookmark(bookmark)
        } catch {
            recordError(describe(error))
        }
    }

    private func recordError(_ message: String) {
        lastErrorMessage = message
        projection.apply(.errorReported(scope: "iphone", message: message))
    }

    private func describe(_ error: Error) -> String {
        switch error {
        case CodexLinkAppLifecycleError.missingConfiguration(let message):
            return message
        case CodexLinkAppLifecycleError.missingRelayClient:
            return "CodexLink Relay client is missing."
        case CodexLinkAppLifecycleError.invalidRelayURL(let value):
            return "Invalid Relay URL: \(value)"
        case CodexLinkDeviceSessionClientError.invalidHTTPStatus(let status):
            return "Device session registration failed with HTTP \(status)."
        case CodexLinkDeviceSessionClientError.invalidRelayURL:
            return "Relay URL is not a valid HTTP, HTTPS, WS, or WSS URL."
        case CodexLinkDeviceSessionStoreError.unreadableData:
            return "Stored Codex Link device session is unreadable."
        case CodexLinkDeviceSessionStoreError.keychainReadFailed(let status):
            return "Stored Codex Link device session could not be read from Keychain (status \(status))."
        case CodexLinkDeviceSessionStoreError.keychainWriteFailed(let status):
            return "Codex Link device session could not be written to Keychain (status \(status))."
        case CodexLinkDeviceSessionStoreError.keychainDeleteFailed(let status):
            return "Codex Link device session could not be deleted from Keychain (status \(status))."
        case CodexLinkBookmarkStoreError.unreadableData:
            return "Stored Codex Link session bookmark is unreadable."
        case CodexLinkRelayClientError.relayError(let code, let message):
            return "Relay error \(code): \(message)"
        case CodexLinkRelayClientError.subscriptionHostMismatch(let expected, let actual):
            return "Relay restored host \(actual), expected \(expected)."
        case CodexLinkRelayClientError.invalidRelayURL:
            return "Relay WebSocket URL is invalid."
        case CodexLinkRelayClientError.unsupportedWebSocketMessage:
            return "Relay sent an unsupported WebSocket message to the iPhone app."
        case CodexLinkRelayClientError.localOnlyAction(let name):
            return "Local-only action reached Relay binding: \(name)"
        case CodexLinkRelayClientError.unsupportedAction(let reason):
            return reason
        default:
            return String(describing: error)
        }
    }

    private static func defaultRelayClientFactory(
        deviceSession: CodexLinkDeviceSession
    ) throws -> any CodexLinkAppRelayClient {
        guard let relayURL = URL(string: deviceSession.relayUrl) else {
            throw CodexLinkAppLifecycleError.invalidRelayURL(deviceSession.relayUrl)
        }
        return CodexLinkRelayWebSocketClient(
            relayURL: relayURL,
            userId: deviceSession.userId,
            deviceId: deviceSession.deviceId,
            deviceToken: deviceSession.deviceToken
        )
    }
}
