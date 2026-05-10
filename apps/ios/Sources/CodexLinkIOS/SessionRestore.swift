import Foundation

public struct CodexLinkSessionBookmark: Codable, Equatable, Sendable {
    public var hostId: String?
    public var projectId: String?
    public var threadId: String?
    public var activeTurnId: String?
    public var lastRelaySequence: Int?

    public init(
        hostId: String? = nil,
        projectId: String? = nil,
        threadId: String? = nil,
        activeTurnId: String? = nil,
        lastRelaySequence: Int? = nil
    ) {
        self.hostId = hostId
        self.projectId = projectId
        self.threadId = threadId
        self.activeTurnId = activeTurnId
        self.lastRelaySequence = lastRelaySequence
    }
}

public enum CodexLinkSessionRestore {
    public static func bookmark(
        from selection: CodexLinkSessionSelection,
        lastRelaySequence: Int?
    ) -> CodexLinkSessionBookmark {
        CodexLinkSessionBookmark(
            hostId: selection.hostId,
            projectId: selection.projectId,
            threadId: selection.threadId,
            activeTurnId: selection.activeTurnId,
            lastRelaySequence: lastRelaySequence
        )
    }

    public static func selection(
        from bookmark: CodexLinkSessionBookmark?,
        projection: CodexLinkProjection
    ) -> CodexLinkSessionSelection {
        guard let bookmark,
              let hostId = bookmark.hostId,
              projection.hosts[hostId] != nil
        else {
            return CodexLinkSessionSelection()
        }

        let projectId: String?
        if let bookmarkedProjectId = bookmark.projectId,
           projection.projectsByHost[hostId]?.contains(where: { $0.id == bookmarkedProjectId }) == true {
            projectId = bookmarkedProjectId
        } else {
            projectId = nil
        }

        let threadId: String?
        if let bookmarkedThreadId = bookmark.threadId,
           let thread = projection.threads[bookmarkedThreadId],
           projectId == nil || thread.projectId == projectId {
            threadId = bookmarkedThreadId
        } else {
            threadId = nil
        }

        let activeTurnId: String?
        if let bookmarkedTurnId = bookmark.activeTurnId,
           projection.turnStatus[bookmarkedTurnId] != nil {
            activeTurnId = bookmarkedTurnId
        } else {
            activeTurnId = nil
        }

        return CodexLinkSessionSelection(
            hostId: hostId,
            projectId: projectId,
            threadId: threadId,
            activeTurnId: activeTurnId
        )
    }
}
