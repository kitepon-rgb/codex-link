import Foundation

public protocol CodexLinkBookmarkStoring: Sendable {
    func loadBookmark() throws -> CodexLinkSessionBookmark?
    func saveBookmark(_ bookmark: CodexLinkSessionBookmark) throws
    func clearBookmark() throws
}

public enum CodexLinkBookmarkStoreError: Error, Equatable, Sendable {
    case unreadableData
}

public final class CodexLinkUserDefaultsBookmarkStore: CodexLinkBookmarkStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(
        defaults: UserDefaults = .standard,
        key: String = "codex-link.session-bookmark",
        encoder: JSONEncoder = JSONEncoder(),
        decoder: JSONDecoder = JSONDecoder()
    ) {
        self.defaults = defaults
        self.key = key
        self.encoder = encoder
        self.decoder = decoder
    }

    public func loadBookmark() throws -> CodexLinkSessionBookmark? {
        guard let data = defaults.data(forKey: key) else {
            return nil
        }
        do {
            return try decoder.decode(CodexLinkSessionBookmark.self, from: data)
        } catch {
            throw CodexLinkBookmarkStoreError.unreadableData
        }
    }

    public func saveBookmark(_ bookmark: CodexLinkSessionBookmark) throws {
        let data = try encoder.encode(bookmark)
        defaults.set(data, forKey: key)
    }

    public func clearBookmark() throws {
        defaults.removeObject(forKey: key)
    }
}

public protocol CodexLinkVisibleSessionRestoring: Sendable {
    func restoreVisibleSession(
        from bookmark: CodexLinkSessionBookmark,
        startingProjection: CodexLinkProjection
    ) async throws -> CodexLinkWebSocketRestoreResult
}

extension CodexLinkRelayWebSocketClient: CodexLinkVisibleSessionRestoring {}

public struct CodexLinkStartupRestoreResult: Equatable, Sendable {
    public var projection: CodexLinkProjection
    public var selection: CodexLinkSessionSelection
    public var bookmark: CodexLinkSessionBookmark?
    public var restoredFromRelay: Bool

    public init(
        projection: CodexLinkProjection,
        selection: CodexLinkSessionSelection,
        bookmark: CodexLinkSessionBookmark?,
        restoredFromRelay: Bool
    ) {
        self.projection = projection
        self.selection = selection
        self.bookmark = bookmark
        self.restoredFromRelay = restoredFromRelay
    }
}

public final class CodexLinkStartupRestorer: @unchecked Sendable {
    private let bookmarkStore: CodexLinkBookmarkStoring
    private let relayClient: CodexLinkVisibleSessionRestoring

    public init(
        bookmarkStore: CodexLinkBookmarkStoring,
        relayClient: CodexLinkVisibleSessionRestoring
    ) {
        self.bookmarkStore = bookmarkStore
        self.relayClient = relayClient
    }

    public func restore(
        startingProjection: CodexLinkProjection = CodexLinkProjection()
    ) async throws -> CodexLinkStartupRestoreResult {
        guard let bookmark = try bookmarkStore.loadBookmark() else {
            return CodexLinkStartupRestoreResult(
                projection: startingProjection,
                selection: CodexLinkSessionSelection(),
                bookmark: nil,
                restoredFromRelay: false
            )
        }

        let restored = try await relayClient.restoreVisibleSession(
            from: bookmark,
            startingProjection: startingProjection
        )
        try bookmarkStore.saveBookmark(restored.bookmark)
        return CodexLinkStartupRestoreResult(
            projection: restored.projection,
            selection: restored.selection,
            bookmark: restored.bookmark,
            restoredFromRelay: true
        )
    }
}
