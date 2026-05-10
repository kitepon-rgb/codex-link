import Foundation

public enum CodexLinkRelayClientError: Error, Equatable, Sendable {
    case invalidRelayURL
    case localOnlyAction(String)
    case unsupportedAction(String)
    case unsupportedWebSocketMessage
    case relayError(code: String, message: String)
    case subscriptionHostMismatch(expected: String, actual: String)
}

public struct CodexLinkWebSocketRestoreResult: Equatable, Sendable {
    public var projection: CodexLinkProjection
    public var selection: CodexLinkSessionSelection
    public var bookmark: CodexLinkSessionBookmark

    public init(
        projection: CodexLinkProjection,
        selection: CodexLinkSessionSelection,
        bookmark: CodexLinkSessionBookmark
    ) {
        self.projection = projection
        self.selection = selection
        self.bookmark = bookmark
    }
}

public final class CodexLinkRelayWebSocketClient: @unchecked Sendable {
    private let relayURL: URL
    private let userId: String
    private let deviceId: String
    private let session: URLSession
    private let actionEncoder: CodexLinkRelayActionEncoder
    private var task: URLSessionWebSocketTask?

    public init(
        relayURL: URL,
        userId: String,
        deviceId: String,
        session: URLSession = .shared,
        actionEncoder: CodexLinkRelayActionEncoder = CodexLinkRelayActionEncoder()
    ) {
        self.relayURL = relayURL
        self.userId = userId
        self.deviceId = deviceId
        self.session = session
        self.actionEncoder = actionEncoder
    }

    public func connect() throws {
        let url = try clientWebSocketURL()
        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()
    }

    public func disconnect() {
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
    }

    public func send(_ action: CodexLinkUIAction, currentHostId: String?, afterSequence: Int? = nil) async throws {
        do {
            let data = try actionEncoder.encode(
                action,
                currentHostId: currentHostId,
                afterSequence: afterSequence
            )
            try await send(data)
        } catch CodexLinkRelayActionEncodingError.localOnlyAction(let name) {
            throw CodexLinkRelayClientError.localOnlyAction(name)
        } catch CodexLinkRelayActionEncodingError.unsupportedAction(let reason) {
            throw CodexLinkRelayClientError.unsupportedAction(reason)
        }
    }

    public func send(_ data: Data) async throws {
        try await requireTask().send(.data(data))
    }

    public func subscribeHost(hostId: String, afterSequence: Int? = nil) async throws {
        let data = try actionEncoder.encode(
            .selectHost(hostId: hostId),
            currentHostId: hostId,
            afterSequence: afterSequence
        )
        try await send(data)
    }

    public func restoreVisibleSession(
        from bookmark: CodexLinkSessionBookmark,
        startingProjection: CodexLinkProjection = CodexLinkProjection()
    ) async throws -> CodexLinkWebSocketRestoreResult {
        guard let hostId = bookmark.hostId else {
            let selection = CodexLinkSessionRestore.selection(
                from: bookmark,
                projection: startingProjection
            )
            return CodexLinkWebSocketRestoreResult(
                projection: startingProjection,
                selection: selection,
                bookmark: bookmark
            )
        }

        try await subscribeHost(hostId: hostId, afterSequence: bookmark.lastRelaySequence)

        var projection = startingProjection
        var restoredBookmark = bookmark
        while true {
            let message = try await receive()
            switch message {
            case .ready:
                continue
            case .hostEvent(let cached):
                projection.apply(cached.event)
                restoredBookmark.lastRelaySequence = max(
                    restoredBookmark.lastRelaySequence ?? 0,
                    cached.sequence
                )
            case .hostSubscriptionReady(let readyHostId, _, let latestSequence):
                guard readyHostId == hostId else {
                    throw CodexLinkRelayClientError.subscriptionHostMismatch(
                        expected: hostId,
                        actual: readyHostId
                    )
                }
                restoredBookmark.lastRelaySequence = max(
                    restoredBookmark.lastRelaySequence ?? 0,
                    latestSequence
                )
                let selection = CodexLinkSessionRestore.selection(
                    from: restoredBookmark,
                    projection: projection
                )
                return CodexLinkWebSocketRestoreResult(
                    projection: projection,
                    selection: selection,
                    bookmark: restoredBookmark
                )
            case .error(let code, let message):
                throw CodexLinkRelayClientError.relayError(code: code, message: message)
            case .hostMessage:
                throw CodexLinkRelayClientError.unsupportedWebSocketMessage
            }
        }
    }

    public func receive() async throws -> RelayServerMessage {
        let message = try await requireTask().receive()
        let data: Data
        switch message {
        case .data(let received):
            data = received
        case .string(let text):
            data = Data(text.utf8)
        @unknown default:
            throw CodexLinkRelayClientError.unsupportedWebSocketMessage
        }
        return try JSONDecoder().decode(RelayServerMessage.self, from: data)
    }

    private func requireTask() throws -> URLSessionWebSocketTask {
        guard let task else {
            throw CodexLinkRelayClientError.invalidRelayURL
        }
        return task
    }

    private func clientWebSocketURL() throws -> URL {
        guard var components = URLComponents(url: relayURL, resolvingAgainstBaseURL: false) else {
            throw CodexLinkRelayClientError.invalidRelayURL
        }
        switch components.scheme {
        case "https":
            components.scheme = "wss"
        case "http":
            components.scheme = "ws"
        case "ws", "wss":
            break
        default:
            throw CodexLinkRelayClientError.invalidRelayURL
        }
        if components.path.isEmpty || components.path == "/" {
            components.path = "/relay"
        }
        var items = components.queryItems ?? []
        items.append(URLQueryItem(name: "kind", value: "client"))
        items.append(URLQueryItem(name: "userId", value: userId))
        items.append(URLQueryItem(name: "deviceId", value: deviceId))
        components.queryItems = items
        guard let url = components.url else {
            throw CodexLinkRelayClientError.invalidRelayURL
        }
        return url
    }
}
