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

        // Trust the bookmark's threadId even when projection.threads doesn't
        // yet know about it. The Relay event cache is bounded, so on
        // reconnect the thread.started event for an older thread may not
        // be replayed; without this trust the iPhone would silently drop
        // the user's last-opened thread and create a new one on next send.
        // If the thread truly no longer exists, mac-host's resumeThread
        // will fail loudly when the user sends, instead of silent drift.
        let threadId: String?
        if let bookmarkedThreadId = bookmark.threadId {
            if let thread = projection.threads[bookmarkedThreadId] {
                if projectId == nil || thread.projectId == projectId {
                    threadId = bookmarkedThreadId
                } else {
                    threadId = nil
                }
            } else {
                threadId = bookmarkedThreadId
            }
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
