import Foundation

public enum CodexLinkLiveActivityVisibility: Equatable, Sendable {
    case hidden
    case active
    case ending
}

public enum CodexLinkDeepLinkError: Error, Equatable, LocalizedError, Sendable {
    case invalidURL

    public var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Codex Link could not build a valid deep link URL."
        }
    }
}

public enum CodexLinkDeepLink {
    public static let defaultScheme = "codexlink"

    public static func openThreadURL(
        hostId: String,
        projectId: String,
        threadId: String,
        turnId: String?,
        scheme: String = defaultScheme
    ) throws -> URL {
        var components = URLComponents()
        components.scheme = scheme
        components.host = "thread"
        components.queryItems = [
            URLQueryItem(name: "hostId", value: hostId),
            URLQueryItem(name: "projectId", value: projectId),
            URLQueryItem(name: "threadId", value: threadId),
        ]
        if let turnId {
            components.queryItems?.append(URLQueryItem(name: "turnId", value: turnId))
        }
        guard let url = components.url else {
            throw CodexLinkDeepLinkError.invalidURL
        }
        return url
    }

    public static func selection(
        from url: URL,
        expectedScheme: String = defaultScheme
    ) -> CodexLinkSessionSelection? {
        guard url.scheme == expectedScheme, url.host == "thread" else {
            return nil
        }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var values: [String: String] = [:]
        for item in components?.queryItems ?? [] where values[item.name] == nil {
            values[item.name] = item.value
        }
        guard
            let hostId = values["hostId"],
            let projectId = values["projectId"],
            let threadId = values["threadId"]
        else {
            return nil
        }
        return CodexLinkSessionSelection(
            hostId: hostId,
            projectId: projectId,
            threadId: threadId,
            activeTurnId: values["turnId"]
        )
    }
}

public struct CodexLinkLiveActivitySnapshot: Equatable, Sendable {
    public let hostId: String
    public let projectId: String
    public let threadId: String
    public let turnId: String
    public let deepLinkURL: URL
    public let state: LiveActivityState

    public init(
        hostId: String,
        projectId: String,
        threadId: String,
        turnId: String,
        deepLinkURL: URL,
        state: LiveActivityState
    ) {
        self.hostId = hostId
        self.projectId = projectId
        self.threadId = threadId
        self.turnId = turnId
        self.deepLinkURL = deepLinkURL
        self.state = state
    }

    public var visibility: CodexLinkLiveActivityVisibility {
        switch state.status {
        case .running, .waitingForApproval:
            return .active
        case .completed, .failed, .canceled:
            return .ending
        case .idle:
            return .hidden
        }
    }

    public static func current(
        from projection: CodexLinkProjection,
        selection: CodexLinkSessionSelection,
        urlScheme: String = CodexLinkDeepLink.defaultScheme
    ) throws -> CodexLinkLiveActivitySnapshot? {
        guard
            let hostId = selection.hostId,
            let projectId = selection.projectId,
            let threadId = selection.threadId,
            let turnId = selection.activeTurnId,
            projection.hosts[hostId] != nil,
            projection.projectsByHost[hostId]?.contains(where: { $0.id == projectId }) == true,
            projection.threads[threadId]?.projectId == projectId
        else {
            return nil
        }

        let deepLinkURL = try CodexLinkDeepLink.openThreadURL(
            hostId: hostId,
            projectId: projectId,
            threadId: threadId,
            turnId: turnId,
            scheme: urlScheme
        )
        return CodexLinkLiveActivitySnapshot(
            hostId: hostId,
            projectId: projectId,
            threadId: threadId,
            turnId: turnId,
            deepLinkURL: deepLinkURL,
            state: projection.liveActivityState(hostId: hostId, projectId: projectId, turnId: turnId)
        )
    }
}

#if os(iOS) && canImport(ActivityKit)
@preconcurrency import ActivityKit

@available(iOS 17.0, *)
public struct CodexLinkTurnActivityAttributes: ActivityAttributes, Equatable, Sendable {
    public struct ContentState: Codable, Equatable, Hashable, Sendable {
        public let hostName: String
        public let projectName: String
        public let status: TurnStatus
        public let latestText: String?
        public let approvalRequired: Bool

        public init(
            hostName: String,
            projectName: String,
            status: TurnStatus,
            latestText: String?,
            approvalRequired: Bool
        ) {
            self.hostName = hostName
            self.projectName = projectName
            self.status = status
            self.latestText = latestText
            self.approvalRequired = approvalRequired
        }
    }

    public let hostId: String
    public let projectId: String
    public let threadId: String
    public let turnId: String
    public let deepLinkURL: URL

    public init(
        hostId: String,
        projectId: String,
        threadId: String,
        turnId: String,
        deepLinkURL: URL
    ) {
        self.hostId = hostId
        self.projectId = projectId
        self.threadId = threadId
        self.turnId = turnId
        self.deepLinkURL = deepLinkURL
    }
}

@available(iOS 17.0, *)
extension CodexLinkTurnActivityAttributes {
    public init(snapshot: CodexLinkLiveActivitySnapshot) {
        self.init(
            hostId: snapshot.hostId,
            projectId: snapshot.projectId,
            threadId: snapshot.threadId,
            turnId: snapshot.turnId,
            deepLinkURL: snapshot.deepLinkURL
        )
    }

    public static func contentState(
        from state: LiveActivityState
    ) -> CodexLinkTurnActivityAttributes.ContentState {
        CodexLinkTurnActivityAttributes.ContentState(
            hostName: state.hostName,
            projectName: state.projectName,
            status: state.status,
            latestText: state.latestText,
            approvalRequired: state.approvalRequired
        )
    }
}

public enum CodexLinkLiveActivityError: Error, Equatable, LocalizedError, Sendable {
    case activitiesDisabled

    public var errorDescription: String? {
        switch self {
        case .activitiesDisabled:
            return "Live Activities are disabled for Codex Link."
        }
    }
}

@available(iOS 17.0, *)
public actor CodexLinkLiveActivityController {
    private let urlScheme: String
    private var currentActivity: Activity<CodexLinkTurnActivityAttributes>?

    public init(urlScheme: String = CodexLinkDeepLink.defaultScheme) {
        self.urlScheme = urlScheme
    }

    @discardableResult
    public func sync(
        projection: CodexLinkProjection,
        selection: CodexLinkSessionSelection
    ) async throws -> CodexLinkLiveActivityVisibility {
        guard let snapshot = try CodexLinkLiveActivitySnapshot.current(
            from: projection,
            selection: selection,
            urlScheme: urlScheme
        ) else {
            await endCurrentActivity(dismissalPolicy: .immediate)
            return .hidden
        }

        switch snapshot.visibility {
        case .hidden:
            await endCurrentActivity(dismissalPolicy: .immediate)
        case .active:
            try await startOrUpdateActivity(for: snapshot)
        case .ending:
            await endActivity(for: snapshot)
        }

        return snapshot.visibility
    }

    public func endActiveActivity() async {
        await endCurrentActivity(dismissalPolicy: .immediate)
    }

    private func startOrUpdateActivity(for snapshot: CodexLinkLiveActivitySnapshot) async throws {
        let content = activityContent(for: snapshot)

        if let activity = trackedActivity(for: snapshot.turnId) {
            await activity.update(content)
            currentActivity = activity
            return
        }

        await endCurrentActivity(dismissalPolicy: .immediate)
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            throw CodexLinkLiveActivityError.activitiesDisabled
        }
        currentActivity = try Activity.request(
            attributes: CodexLinkTurnActivityAttributes(snapshot: snapshot),
            content: content,
            pushType: nil
        )
    }

    private func endActivity(for snapshot: CodexLinkLiveActivitySnapshot) async {
        guard let activity = trackedActivity(for: snapshot.turnId) else {
            return
        }
        await activity.end(activityContent(for: snapshot), dismissalPolicy: .default)
        currentActivity = nil
    }

    private func endCurrentActivity(dismissalPolicy: ActivityUIDismissalPolicy) async {
        guard let activity = currentActivity else {
            return
        }
        await activity.end(nil, dismissalPolicy: dismissalPolicy)
        currentActivity = nil
    }

    private func trackedActivity(
        for turnId: String
    ) -> Activity<CodexLinkTurnActivityAttributes>? {
        if let currentActivity, currentActivity.attributes.turnId == turnId {
            return currentActivity
        }
        return Activity<CodexLinkTurnActivityAttributes>.activities.first {
            $0.attributes.turnId == turnId
        }
    }

    private func activityContent(
        for snapshot: CodexLinkLiveActivitySnapshot
    ) -> ActivityContent<CodexLinkTurnActivityAttributes.ContentState> {
        ActivityContent(
            state: CodexLinkTurnActivityAttributes.contentState(from: snapshot.state),
            staleDate: nil,
            relevanceScore: snapshot.state.approvalRequired ? 100 : 50
        )
    }
}
#endif

#if os(iOS) && canImport(ActivityKit) && canImport(WidgetKit) && canImport(SwiftUI)
import SwiftUI
import WidgetKit

@available(iOS 17.0, *)
public struct CodexLinkTurnLiveActivityWidget: Widget {
    public let kind = "CodexLinkTurnLiveActivity"

    public init() {}

    public var body: some WidgetConfiguration {
        ActivityConfiguration(for: CodexLinkTurnActivityAttributes.self) { context in
            CodexLinkTurnLiveActivityLockScreenView(state: context.state)
                .activityBackgroundTint(Color.black.opacity(0.86))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.attributes.deepLinkURL)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.projectName)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Label(context.state.activityLabel, systemImage: context.state.symbolName)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(context.state.tint)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.displayText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            } compactLeading: {
                Image(systemName: context.state.symbolName)
                    .foregroundStyle(context.state.tint)
            } compactTrailing: {
                Text(context.state.compactLabel)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(context.state.tint)
            } minimal: {
                Image(systemName: context.state.symbolName)
                    .foregroundStyle(context.state.tint)
            }
            .widgetURL(context.attributes.deepLinkURL)
            .keylineTint(context.state.tint)
        }
    }
}

@available(iOS 17.0, *)
private struct CodexLinkTurnLiveActivityLockScreenView: View {
    let state: CodexLinkTurnActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: state.symbolName)
                    .foregroundStyle(state.tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.projectName)
                        .font(.headline)
                        .lineLimit(1)
                    Text(state.hostName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Text(state.activityLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(state.tint)
            }
            Text(state.displayText)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .padding(.vertical, 4)
    }
}

@available(iOS 17.0, *)
private extension CodexLinkTurnActivityAttributes.ContentState {
    var displayText: String {
        if approvalRequired {
            return latestText ?? "Approval required"
        }
        return latestText ?? activityLabel
    }

    var activityLabel: String {
        if approvalRequired {
            return "Needs approval"
        }
        switch status {
        case .idle:
            return "Idle"
        case .running:
            return "Running"
        case .waitingForApproval:
            return "Needs approval"
        case .completed:
            return "Done"
        case .failed:
            return "Failed"
        case .canceled:
            return "Canceled"
        }
    }

    var compactLabel: String {
        if approvalRequired {
            return "Approve"
        }
        switch status {
        case .idle:
            return "Idle"
        case .running:
            return "Run"
        case .waitingForApproval:
            return "Approve"
        case .completed:
            return "Done"
        case .failed:
            return "Fail"
        case .canceled:
            return "Stop"
        }
    }

    var symbolName: String {
        if approvalRequired {
            return "hand.raised.fill"
        }
        switch status {
        case .idle:
            return "circle"
        case .running:
            return "sparkle"
        case .waitingForApproval:
            return "hand.raised.fill"
        case .completed:
            return "checkmark.circle.fill"
        case .failed:
            return "xmark.circle.fill"
        case .canceled:
            return "stop.circle.fill"
        }
    }

    var tint: Color {
        if approvalRequired {
            return .orange
        }
        switch status {
        case .idle, .completed, .canceled:
            return .secondary
        case .running:
            return .teal
        case .waitingForApproval:
            return .orange
        case .failed:
            return .red
        }
    }
}
#endif
