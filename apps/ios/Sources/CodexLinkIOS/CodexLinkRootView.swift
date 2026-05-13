import SwiftUI
import os

enum CodexLinkUILogger {
    static let composer = Logger(subsystem: "dev.codexlink.ios", category: "composer")
    static let session = Logger(subsystem: "dev.codexlink.ios", category: "session")
}

@available(iOS 17.0, macOS 14.0, *)
public struct CodexLinkRootView: View {
    private let projection: CodexLinkProjection
    private let connectionState: CodexLinkConnectionState
    @Binding private var selection: CodexLinkSessionSelection
    private let onAction: (CodexLinkUIAction) -> Void

    public init(
        projection: CodexLinkProjection,
        connectionState: CodexLinkConnectionState = .connected,
        selection: Binding<CodexLinkSessionSelection>,
        onAction: @escaping (CodexLinkUIAction) -> Void
    ) {
        self.projection = projection
        self.connectionState = connectionState
        self._selection = selection
        self.onAction = onAction
    }

    public var body: some View {
        NavigationStack {
            if shouldShowHostPicker {
                PairFlow(
                    hosts: sortedHosts,
                    projectsByHost: projection.projectsByHost,
                    connectionState: connectionState,
                    latestError: projection.latestError,
                    select: selectHost,
                    pair: pairHost,
                    dismissError: { onAction(.dismissError) }
                )
            } else {
                SessionFlow(
                    projection: projection,
                    connectionState: connectionState,
                    selection: $selection,
                    onAction: onAction
                )
            }
        }
        .tint(.accentColor)
    }

    private var sortedHosts: [Host] {
        projection.hosts.values.sorted { first, second in
            if first.status != second.status {
                return first.status == .online
            }
            return first.name.localizedCaseInsensitiveCompare(second.name) == .orderedAscending
        }
    }

    private var shouldShowHostPicker: Bool {
        guard let hostId = selection.hostId else { return true }
        return projection.hosts[hostId] == nil
    }

    private func selectHost(_ host: Host) {
        selection.hostId = host.id
        selection.projectId = projection.projectsByHost[host.id]?.first?.id
        selection.threadId = nil
        selection.activeTurnId = nil
        onAction(.selectHost(hostId: host.id))
    }

    private func pairHost(_ pairingCode: String) {
        onAction(.pairHost(pairingCode: pairingCode))
    }
}

// MARK: - Pair flow

@available(iOS 17.0, macOS 14.0, *)
private struct PairFlow: View {
    let hosts: [Host]
    let projectsByHost: [String: [ProjectRef]]
    let connectionState: CodexLinkConnectionState
    let latestError: String?
    let select: (Host) -> Void
    let pair: (String) -> Void
    let dismissError: () -> Void

    @State private var manualCode = ""
    @State private var showManualEntry = false
    @State private var isPresentingScanner = false
    @State private var scannerError: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                if let latestError {
                    InlineBanner(
                        tint: .red,
                        icon: "exclamationmark.triangle.fill",
                        title: latestError,
                        detail: nil,
                        onDismiss: dismissError
                    )
                } else if connectionState != .connected {
                    InlineBanner(
                        tint: ConnectionStyle.color(for: connectionState),
                        icon: ConnectionStyle.icon(for: connectionState),
                        title: ConnectionStyle.label(for: connectionState),
                        detail: nil
                    )
                }

                PairHero(
                    onScanQR: {
                        scannerError = nil
                        isPresentingScanner = true
                    },
                    onToggleManual: {
                        withAnimation(.snappy) {
                            showManualEntry.toggle()
                        }
                    },
                    showManualEntry: showManualEntry
                )

                if showManualEntry {
                    ManualPairCard(code: $manualCode, onSubmit: submitManual)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                if let scannerError {
                    InlineBanner(
                        tint: .red,
                        icon: "qrcode.viewfinder",
                        title: "Couldn't read pairing code",
                        detail: scannerError
                    )
                }

                if !hosts.isEmpty {
                    SectionHeading("Paired Macs")
                    VStack(spacing: 10) {
                        ForEach(hosts) { host in
                            HostCard(
                                host: host,
                                projectCount: projectsByHost[host.id]?.count ?? 0,
                                firstProjectName: projectsByHost[host.id]?.first?.name,
                                onSelect: { select(host) }
                            )
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 32)
        }
        .background(Color.clGroupedBackground)
        .navigationTitle("Codex Link")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        .fullScreenCover(isPresented: $isPresentingScanner) {
            CodexLinkPairingScannerView(
                onPairingPayload: { payload in
                    isPresentingScanner = false
                    pair(payload.pairingCode)
                },
                onError: { error in
                    scannerError = error.localizedDescription
                    isPresentingScanner = false
                },
                onCancel: {
                    isPresentingScanner = false
                }
            )
            .ignoresSafeArea()
        }
        #endif
    }

    private func submitManual() {
        let code = manualCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else { return }
        pair(code)
        manualCode = ""
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct PairHero: View {
    let onScanQR: () -> Void
    let onToggleManual: () -> Void
    let showManualEntry: Bool

    var body: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle()
                    .fill(LinearGradient(
                        colors: [Color.accentColor.opacity(0.22), Color.accentColor.opacity(0.06)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ))
                    .frame(width: 84, height: 84)
                Image(systemName: "laptopcomputer.and.iphone")
                    .font(.system(size: 36, weight: .semibold))
                    .foregroundStyle(.tint)
            }
            .padding(.top, 4)

            VStack(spacing: 6) {
                Text("Pair your Mac")
                    .font(.title2.weight(.semibold))
                Text("Scan the QR code shown by mac-host on your Mac, or paste the pairing code below.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)
            }

            #if os(iOS)
            Button(action: onScanQR) {
                Label("Scan QR code", systemImage: "qrcode.viewfinder")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityLabel("Scan pairing QR")
            #endif

            Button(action: onToggleManual) {
                HStack(spacing: 6) {
                    Text(showManualEntry ? "Hide manual entry" : "Enter code manually")
                    Image(systemName: showManualEntry ? "chevron.up" : "chevron.down")
                        .font(.footnote.weight(.semibold))
                }
                .font(.callout.weight(.medium))
                .foregroundStyle(.tint)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(Color.clElevated)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct ManualPairCard: View {
    @Binding var code: String
    let onSubmit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pairing code")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .tracking(0.6)

            HStack(spacing: 10) {
                TextField("ABCD-EFGH", text: $code)
                    .font(.system(.body, design: .monospaced))
                    #if os(iOS)
                    .textInputAutocapitalization(.characters)
                    .keyboardType(.asciiCapable)
                    .autocorrectionDisabled()
                    #endif
                    .padding(.horizontal, 12)
                    .padding(.vertical, 11)
                    .background(Color.clFill)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                Button(action: onSubmit) {
                    Image(systemName: "link")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.borderedProminent)
                .disabled(code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("Pair Host")
            }
        }
        .padding(16)
        .background(Color.clElevated)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct HostCard: View {
    let host: Host
    let projectCount: Int
    let firstProjectName: String?
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(host.status == .online
                            ? Color.green.opacity(0.16)
                            : Color.secondary.opacity(0.14))
                        .frame(width: 44, height: 44)
                    Image(systemName: host.platform == "macos" ? "laptopcomputer" : "desktopcomputer")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(host.status == .online ? Color.green : Color.secondary)
                }

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(host.name)
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        Circle()
                            .fill(host.status == .online ? Color.green : Color.secondary.opacity(0.5))
                            .frame(width: 7, height: 7)
                    }
                    Text(projectsSummary)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(14)
            .background(Color.clElevated)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var projectsSummary: String {
        if host.status != .online {
            return "Offline"
        }
        if projectCount == 0 {
            return "No projects yet"
        }
        let first = firstProjectName ?? "Project"
        if projectCount == 1 {
            return first
        }
        return "\(first) · +\(projectCount - 1) more"
    }
}

// MARK: - Session flow

@available(iOS 17.0, macOS 14.0, *)
private struct SessionFlow: View {
    let projection: CodexLinkProjection
    let connectionState: CodexLinkConnectionState
    @Binding var selection: CodexLinkSessionSelection
    let onAction: (CodexLinkUIAction) -> Void

    @State private var draft = ""
    @State private var showThreads = false
    @State private var showSettings = false

    var body: some View {
        VStack(spacing: 0) {
            if isRunning {
                ProgressView()
                    .progressViewStyle(.linear)
                    .tint(.accentColor)
                    .frame(height: 2)
                    .clipped()
            } else {
                Color.clear.frame(height: 2)
            }

            if shouldShowConnectionBanner {
                ConnectionBanner(
                    state: connectionState,
                    latestError: projection.latestError,
                    onDismissError: { onAction(.dismissError) }
                )
                .padding(.horizontal, 16)
                .padding(.top, 6)
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            ConversationFeed(
                entries: feed,
                isRunning: isRunning,
                hostName: selectedHost?.name,
                projectName: selectedProject?.name
            )

            if let pending = pendingApproval {
                ApprovalBanner(
                    request: pending,
                    onAction: onAction
                )
                .padding(.horizontal, 12)
                .padding(.bottom, 6)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            Composer(
                text: $draft,
                isRunning: isRunning,
                isApprovalPending: pendingApproval != nil,
                send: sendDraft,
                interrupt: interrupt
            )
        }
        .background(Color.clBackground)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .principal) {
                SessionTitleView(
                    title: headerTitle,
                    subtitle: headerSubtitle,
                    statusText: statusBadgeText,
                    statusColor: statusBadgeColor,
                    onTap: { showThreads = true }
                )
            }
            ToolbarItem(placement: .cancellationAction) {
                Button {
                    showThreads = true
                } label: {
                    Image(systemName: "list.bullet.indent")
                        .font(.body.weight(.semibold))
                }
                .accessibilityLabel("Threads")
            }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button {
                        startNewThread()
                    } label: {
                        Label("New thread", systemImage: "square.and.pencil")
                    }
                    Button {
                        showThreads = true
                    } label: {
                        Label("Open thread…", systemImage: "list.bullet.indent")
                    }
                    Divider()
                    Button {
                        showSettings = true
                    } label: {
                        Label("Settings", systemImage: "gearshape")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.body.weight(.semibold))
                }
                .accessibilityLabel("More")
            }
        }
        .sheet(isPresented: $showThreads) {
            ThreadsSheet(
                projects: selectedHostProjects,
                threads: sortedThreads,
                selection: $selection,
                onAction: onAction
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showSettings) {
            SettingsSheet(
                projection: projection,
                connectionState: connectionState,
                selection: selection,
                onAction: onAction
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .animation(.snappy, value: pendingApproval?.id)
        .animation(.snappy, value: isRunning)
        .animation(.snappy, value: shouldShowConnectionBanner)
    }

    // MARK: - Derived state

    private var selectedHost: Host? {
        selection.hostId.flatMap { projection.hosts[$0] }
    }

    private var selectedHostProjects: [ProjectRef] {
        guard let hostId = selection.hostId else { return [] }
        return projection.projectsByHost[hostId] ?? []
    }

    private var selectedProject: ProjectRef? {
        guard let projectId = selection.projectId else { return nil }
        return selectedHostProjects.first(where: { $0.id == projectId })
    }

    private var selectedThread: ThreadRef? {
        guard let threadId = selection.threadId else { return nil }
        return projection.threads[threadId]
    }

    private var headerTitle: String {
        if let title = selectedThread?.title, !title.isEmpty {
            return title
        }
        if selection.threadId == nil {
            return "New thread"
        }
        if let project = selectedProject {
            return project.name
        }
        return selectedHost?.name ?? "Codex Link"
    }

    private var headerSubtitle: String? {
        let host = selectedHost?.name
        let project = selectedProject?.name
        switch (host, project) {
        case let (h?, p?):
            return p == headerTitle ? h : "\(h) · \(p)"
        case let (h?, nil):
            return h
        case let (nil, p?):
            return p
        default:
            return nil
        }
    }

    private var statusBadgeText: String? {
        switch currentStatus {
        case .running:
            return "Running"
        case .waitingForApproval:
            return "Awaiting approval"
        case .failed:
            return "Failed"
        case .canceled:
            return "Canceled"
        case .idle, .completed:
            return nil
        }
    }

    private var statusBadgeColor: Color {
        switch currentStatus {
        case .running: return .accentColor
        case .waitingForApproval: return .orange
        case .failed: return .red
        case .canceled: return .secondary
        default: return .secondary
        }
    }

    private var visibleTranscript: [TranscriptItem] {
        guard let threadId = selection.threadId else {
            return []
        }
        return projection.transcript.filter { $0.threadId == threadId }
    }

    private var visibleTimeline: [TimelineItem] {
        guard let threadId = selection.threadId else {
            return []
        }
        return projection.timeline.filter { $0.threadId == threadId }
    }

    private var visibleApprovals: [ApprovalRequest] {
        guard let threadId = selection.threadId else {
            return []
        }
        return projection.approvals.filter { $0.threadId == threadId }
    }

    private var pendingApproval: ApprovalRequest? {
        visibleApprovals.first
    }

    private var sortedThreads: [ThreadRef] {
        projection.threads.values.sorted { first, second in
            switch (first.updatedAt, second.updatedAt) {
            case let (a?, b?):
                return a > b
            case (_?, nil):
                return true
            case (nil, _?):
                return false
            default:
                // Both lack updatedAt. Codex thread ids are UUIDv7-style
                // (timestamp-prefixed), so a lexicographic descending sort
                // puts the newest thread first.
                return first.id > second.id
            }
        }
    }

    private var activeTurnId: String? {
        selection.activeTurnId
            ?? visibleApprovals.last?.turnId
            ?? visibleTimeline.last?.turnId
            ?? visibleTranscript.last?.turnId
    }

    private var currentStatus: TurnStatus {
        guard let activeTurnId else { return .idle }
        return projection.turnStatus[activeTurnId] ?? .idle
    }

    private var isRunning: Bool {
        currentStatus == .running
    }

    private var shouldShowConnectionBanner: Bool {
        switch connectionState {
        case .connected, .restored:
            return projection.latestError != nil
        default:
            return true
        }
    }

    private var feed: [FeedEntry] {
        FeedBuilder.build(
            transcript: visibleTranscript,
            timeline: visibleTimeline
        )
    }

    // MARK: - Actions

    private func sendDraft() {
        let prompt = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        CodexLinkUILogger.composer.info("send tapped: empty=\(prompt.isEmpty), running=\(isRunning), threadId=\(selection.threadId ?? "nil"), projectId=\(selection.projectId ?? "nil")")
        guard !prompt.isEmpty else { return }

        if isRunning {
            guard let threadId = selection.threadId, let turnId = activeTurnId else {
                CodexLinkUILogger.composer.error("steer aborted: missing threadId or turnId")
                onAction(.unsupportedOperation(reason: "running turn is missing thread or turn id"))
                return
            }
            CodexLinkUILogger.composer.info("dispatching steerPrompt: turnId=\(turnId), len=\(prompt.count)")
            onAction(.steerPrompt(threadId: threadId, turnId: turnId, prompt: prompt))
        } else {
            guard let projectId = selection.projectId else {
                CodexLinkUILogger.composer.error("send aborted: projectId is nil")
                onAction(.unsupportedOperation(reason: "project is not selected"))
                return
            }
            CodexLinkUILogger.composer.info("dispatching sendPrompt: projectId=\(projectId), threadId=\(selection.threadId ?? "nil"), len=\(prompt.count)")
            onAction(.sendPrompt(projectId: projectId, threadId: selection.threadId, prompt: prompt))
        }
        draft = ""
    }

    private func interrupt() {
        guard let threadId = selection.threadId, let turnId = activeTurnId else {
            CodexLinkUILogger.composer.error("interrupt aborted: missing threadId or turnId")
            onAction(.unsupportedOperation(reason: "running turn is missing thread or turn id"))
            return
        }
        CodexLinkUILogger.composer.info("dispatching interrupt: turnId=\(turnId)")
        onAction(.interrupt(threadId: threadId, turnId: turnId))
    }

    private func startNewThread() {
        CodexLinkUILogger.composer.info("startNewThread: clearing threadId/activeTurnId")
        selection.threadId = nil
        selection.activeTurnId = nil
        draft = ""
    }
}

// MARK: - Session header

@available(iOS 17.0, macOS 14.0, *)
private struct SessionTitleView: View {
    let title: String
    let subtitle: String?
    let statusText: String?
    let statusColor: Color
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 1) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                HStack(spacing: 6) {
                    if let statusText {
                        Circle()
                            .fill(statusColor)
                            .frame(width: 6, height: 6)
                        Text(statusText)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(statusColor)
                    }
                    if let subtitle {
                        if statusText != nil {
                            Text("·")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        Text(subtitle)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
            .frame(maxWidth: 240)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Switch thread or project")
    }
}

// MARK: - Connection banner

@available(iOS 17.0, macOS 14.0, *)
private struct ConnectionBanner: View {
    let state: CodexLinkConnectionState
    let latestError: String?
    let onDismissError: (() -> Void)?

    var body: some View {
        InlineBanner(
            tint: tint,
            icon: icon,
            title: title,
            detail: latestError,
            onDismiss: latestError != nil ? onDismissError : nil
        )
    }

    private var tint: Color {
        if latestError != nil { return .red }
        return ConnectionStyle.color(for: state)
    }

    private var icon: String {
        if latestError != nil { return "exclamationmark.triangle.fill" }
        return ConnectionStyle.icon(for: state)
    }

    private var title: String {
        if latestError != nil { return "Something went wrong" }
        return ConnectionStyle.label(for: state)
    }
}

// MARK: - Conversation feed

private enum FeedEntry: Identifiable {
    case message(TranscriptItem)
    case activity(TimelineItem)

    var id: String {
        switch self {
        case .message(let item): return "msg-\(item.id)"
        case .activity(let item): return "act-\(item.id)"
        }
    }
}

private enum FeedBuilder {
    static func build(transcript: [TranscriptItem], timeline: [TimelineItem]) -> [FeedEntry] {
        var entries: [FeedEntry] = []
        var seenTurns: Set<String> = []
        var lastTurn: String?
        let grouped = Dictionary(grouping: timeline) { $0.turnId }

        func flush(_ turnId: String) {
            guard !seenTurns.contains(turnId) else { return }
            for activity in grouped[turnId] ?? [] {
                entries.append(.activity(activity))
            }
            seenTurns.insert(turnId)
        }

        for item in transcript {
            if let last = lastTurn, last != item.turnId {
                flush(last)
            }
            entries.append(.message(item))
            lastTurn = item.turnId
        }
        if let last = lastTurn {
            flush(last)
        }
        for activity in timeline where !seenTurns.contains(activity.turnId) {
            flush(activity.turnId)
        }
        return entries
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct ConversationFeed: View {
    let entries: [FeedEntry]
    let isRunning: Bool
    let hostName: String?
    let projectName: String?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if entries.isEmpty {
                    EmptyConversation(
                        hostName: hostName,
                        projectName: projectName
                    )
                    .padding(.top, 48)
                } else {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        ForEach(entries) { entry in
                            switch entry {
                            case .message(let item):
                                MessageRow(item: item)
                                    .id(entry.id)
                            case .activity(let item):
                                ActivityRow(item: item)
                                    .id(entry.id)
                            }
                        }
                        if isRunning {
                            TypingIndicator()
                                .id("typing-indicator")
                                .padding(.top, 2)
                        }
                        Color.clear.frame(height: 8).id("feed-tail")
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                    .padding(.bottom, 8)
                }
            }
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
            .onChange(of: entries.last?.id) { _, _ in
                scrollToTail(proxy)
            }
            .onChange(of: isRunning) { _, _ in
                scrollToTail(proxy)
            }
            .onAppear {
                scrollToTail(proxy, animated: false)
            }
        }
    }

    private func scrollToTail(_ proxy: ScrollViewProxy, animated: Bool = true) {
        let target = isRunning ? "typing-indicator" : (entries.last?.id ?? "feed-tail")
        if animated {
            withAnimation(.snappy) {
                proxy.scrollTo(target, anchor: .bottom)
            }
        } else {
            proxy.scrollTo(target, anchor: .bottom)
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct EmptyConversation: View {
    let hostName: String?
    let projectName: String?

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.10))
                    .frame(width: 72, height: 72)
                Image(systemName: "sparkles")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(.tint)
            }
            Text("Ready when you are")
                .font(.title3.weight(.semibold))
            Text(detailText)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity)
    }

    private var detailText: String {
        switch (hostName, projectName) {
        case let (host?, project?):
            return "Send a prompt to ask Codex to do something on \(host) in \(project)."
        case let (host?, nil):
            return "Send a prompt to ask Codex to do something on \(host)."
        default:
            return "Send a prompt below to start a new thread."
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct MessageRow: View {
    let item: TranscriptItem

    var body: some View {
        switch item.role {
        case .user:
            UserMessage(text: item.text)
        case .assistant:
            AssistantMessage(text: item.text)
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct UserMessage: View {
    let text: String

    var body: some View {
        HStack {
            Spacer(minLength: 48)
            Text(text)
                .font(.body)
                .foregroundStyle(.white)
                .textSelection(.enabled)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.accentColor)
                .clipShape(BubbleShape(role: .user))
                .frame(maxWidth: 560, alignment: .trailing)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct AssistantMessage: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.16))
                    .frame(width: 28, height: 28)
                Image(systemName: "sparkle")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.tint)
            }
            .padding(.top, 2)

            VStack(alignment: .leading, spacing: 4) {
                Text("Codex")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(text)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.trailing, 32)
    }
}

private struct BubbleShape: Shape {
    enum Role { case user, assistant }
    let role: Role

    func path(in rect: CGRect) -> Path {
        let corner: CGFloat = 18
        let tail: CGFloat = 6
        var path = Path()
        switch role {
        case .user:
            path.addRoundedRect(
                in: rect,
                cornerSize: CGSize(width: corner, height: corner),
                style: .continuous
            )
            path.addRoundedRect(
                in: CGRect(x: rect.maxX - tail - 2, y: rect.maxY - tail - 2, width: tail, height: tail),
                cornerSize: CGSize(width: 2, height: 2)
            )
        case .assistant:
            path.addRoundedRect(
                in: rect,
                cornerSize: CGSize(width: corner, height: corner),
                style: .continuous
            )
        }
        return path
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct ActivityRow: View {
    let item: TimelineItem
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                guard item.detail?.isEmpty == false else { return }
                withAnimation(.snappy) {
                    expanded.toggle()
                }
            } label: {
                HStack(alignment: .center, spacing: 10) {
                    StatusDot(status: item.status)
                    Image(systemName: icon)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(tint)
                        .frame(width: 18)
                    Text(item.label)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                    Spacer(minLength: 4)
                    if item.detail?.isEmpty == false {
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if expanded, let detail = item.detail, !detail.isEmpty {
                Divider().padding(.horizontal, 12)
                Text(detail)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
            }
        }
        .background(Color.clElevatedAlt)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.leading, 38)
        .padding(.trailing, 32)
    }

    private var icon: String {
        switch item.status {
        case .running: return "gearshape.2"
        case .completed: return "checkmark"
        case .failed: return "xmark"
        case .declined: return "nosign"
        }
    }

    private var tint: Color {
        switch item.status {
        case .running: return .accentColor
        case .completed: return .green
        case .failed: return .red
        case .declined: return .orange
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct StatusDot: View {
    let status: TimelineStatus
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .overlay(
                Circle()
                    .stroke(color.opacity(0.4), lineWidth: 4)
                    .scaleEffect(pulse ? 1.8 : 1.0)
                    .opacity(pulse ? 0.0 : 0.6)
            )
            .onAppear {
                if status == .running {
                    withAnimation(.easeOut(duration: 1.2).repeatForever(autoreverses: false)) {
                        pulse = true
                    }
                }
            }
    }

    private var color: Color {
        switch status {
        case .running: return .accentColor
        case .completed: return .green
        case .failed: return .red
        case .declined: return .orange
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct TypingIndicator: View {
    @State private var animate = false

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.16))
                    .frame(width: 28, height: 28)
                Image(systemName: "sparkle")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.tint)
            }

            HStack(spacing: 4) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(Color.secondary.opacity(0.6))
                        .frame(width: 6, height: 6)
                        .scaleEffect(animate ? 1.0 : 0.5)
                        .animation(
                            .easeInOut(duration: 0.6)
                                .repeatForever(autoreverses: true)
                                .delay(Double(i) * 0.15),
                            value: animate
                        )
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(Color.clElevatedAlt)
            .clipShape(Capsule())
            Spacer()
        }
        .padding(.trailing, 32)
        .onAppear { animate = true }
    }
}

// MARK: - Approval banner

@available(iOS 17.0, macOS 14.0, *)
private struct ApprovalBanner: View {
    let request: ApprovalRequest
    let onAction: (CodexLinkUIAction) -> Void
    @State private var showDetail = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.orange.opacity(0.18))
                        .frame(width: 36, height: 36)
                    Image(systemName: icon)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.orange)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(request.title)
                        .font(.subheadline.weight(.semibold))
                    Text(approvalKindLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    showDetail = true
                } label: {
                    Image(systemName: "info.circle")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Show details")
            }

            if !request.detail.isEmpty {
                Text(request.detail)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.primary.opacity(0.85))
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Color.clTertiary)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            HStack(spacing: 8) {
                ForEach(orderedDecisions, id: \.self) { decision in
                    Button {
                        onAction(.approvalDecision(requestId: request.id, decision: decision))
                    } label: {
                        Text(label(for: decision))
                            .font(.callout.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(tint(for: decision))
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.clElevatedAlt)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.orange.opacity(0.4), lineWidth: 1)
        )
        .sheet(isPresented: $showDetail) {
            ApprovalDetailSheet(request: request, onAction: onAction)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private var orderedDecisions: [ApprovalDecisionKind] {
        let order: [ApprovalDecisionKind] = [.decline, .acceptForSession, .accept, .cancel]
        return order.filter { request.availableDecisions.contains($0) }
    }

    private var icon: String {
        switch request.kind {
        case .commandExecution: return "terminal"
        case .fileChange: return "doc.badge.gearshape"
        case .network: return "network"
        case .userInput: return "questionmark.bubble"
        }
    }

    private var approvalKindLabel: String {
        switch request.kind {
        case .commandExecution: return "Command execution"
        case .fileChange: return "File change"
        case .network: return "Network access"
        case .userInput: return "User input"
        }
    }

    private func label(for decision: ApprovalDecisionKind) -> String {
        switch decision {
        case .accept: return "Allow"
        case .acceptForSession: return "Allow Session"
        case .decline: return "Deny"
        case .cancel: return "Cancel"
        }
    }

    private func tint(for decision: ApprovalDecisionKind) -> Color {
        switch decision {
        case .accept: return .accentColor
        case .acceptForSession: return .accentColor.opacity(0.85)
        case .decline: return .red
        case .cancel: return .secondary
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct ApprovalDetailSheet: View {
    let request: ApprovalRequest
    let onAction: (CodexLinkUIAction) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(request.title)
                        .font(.title3.weight(.semibold))
                    Text(request.detail)
                        .font(.system(.callout, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .padding(12)
                        .background(Color.clElevatedAlt)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    VStack(spacing: 8) {
                        ForEach(request.availableDecisions, id: \.self) { decision in
                            Button {
                                onAction(.approvalDecision(requestId: request.id, decision: decision))
                                dismiss()
                            } label: {
                                Text(longLabel(for: decision))
                                    .font(.callout.weight(.semibold))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(tint(for: decision))
                        }
                    }
                    .padding(.top, 4)
                }
                .padding(16)
            }
            .navigationTitle("Approval")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func longLabel(for decision: ApprovalDecisionKind) -> String {
        switch decision {
        case .accept: return "Allow once"
        case .acceptForSession: return "Allow for this session"
        case .decline: return "Deny"
        case .cancel: return "Cancel turn"
        }
    }

    private func tint(for decision: ApprovalDecisionKind) -> Color {
        switch decision {
        case .accept, .acceptForSession: return .accentColor
        case .decline: return .red
        case .cancel: return .secondary
        }
    }
}

// MARK: - Composer

@available(iOS 17.0, macOS 14.0, *)
private struct Composer: View {
    @Binding var text: String
    let isRunning: Bool
    let isApprovalPending: Bool
    let send: () -> Void
    let interrupt: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            Divider().opacity(0.6)
            HStack(alignment: .bottom, spacing: 10) {
                TextField(placeholder, text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...6)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .background(Color.clElevatedAlt)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .focused($focused)
                    .toolbar {
                        #if os(iOS)
                        ToolbarItemGroup(placement: .keyboard) {
                            Spacer()
                            Button("Done") { focused = false }
                        }
                        #endif
                    }

                if isRunning {
                    Button {
                        interrupt()
                    } label: {
                        Image(systemName: "stop.fill")
                            .font(.system(size: 16, weight: .bold))
                            .frame(width: 22, height: 22)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.circle)
                    .controlSize(.large)
                    .tint(.red)
                    .accessibilityLabel("Stop running turn")
                }

                Button {
                    send()
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 16, weight: .bold))
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.circle)
                .controlSize(.large)
                .tint(canSend ? Color.accentColor : Color.secondary)
                .disabled(!canSend)
                .accessibilityLabel(isRunning ? "Send steer" : "Send prompt")
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 10)
            .background(.ultraThinMaterial)
        }
    }

    private var placeholder: String {
        if isApprovalPending {
            return "Waiting for your approval above…"
        }
        if isRunning {
            return "Steer the running turn…"
        }
        return "Message Codex"
    }

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - Threads sheet

@available(iOS 17.0, macOS 14.0, *)
private struct ThreadsSheet: View {
    let projects: [ProjectRef]
    let threads: [ThreadRef]
    @Binding var selection: CodexLinkSessionSelection
    let onAction: (CodexLinkUIAction) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if !projects.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionHeading("Projects")
                            VStack(spacing: 8) {
                                ForEach(projects) { project in
                                    ProjectRow(
                                        project: project,
                                        selected: selection.projectId == project.id,
                                        onSelect: {
                                            selection.projectId = project.id
                                            selection.threadId = nil
                                            selection.activeTurnId = nil
                                            onAction(.selectProject(projectId: project.id))
                                            dismiss()
                                        }
                                    )
                                }
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        SectionHeading("Threads")
                        NewThreadRow(
                            highlighted: selection.threadId == nil,
                            onSelect: {
                                selection.threadId = nil
                                selection.activeTurnId = nil
                                dismiss()
                            }
                        )
                        if threadsForSelectedProject.isEmpty {
                            Text("No saved threads yet. Send a prompt to start one.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 12)
                                .padding(.horizontal, 14)
                        } else {
                            VStack(spacing: 8) {
                                ForEach(threadsForSelectedProject) { thread in
                                    ThreadRow(
                                        thread: thread,
                                        selected: selection.threadId == thread.id,
                                        onSelect: {
                                            selection.threadId = thread.id
                                            selection.projectId = thread.projectId
                                            selection.activeTurnId = nil
                                            onAction(.restoreThread(projectId: thread.projectId, threadId: thread.id))
                                            dismiss()
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .background(Color.clGroupedBackground)
            .navigationTitle("Sessions")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var threadsForSelectedProject: [ThreadRef] {
        guard let projectId = selection.projectId else {
            return threads
        }
        return threads.filter { $0.projectId == projectId }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct ProjectRow: View {
    let project: ProjectRef
    let selected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 12) {
                Image(systemName: "folder.fill")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.tint)
                    .frame(width: 28, height: 28)
                    .background(Color.accentColor.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(project.name)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(project.pathLabel)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
                if selected {
                    Image(systemName: "checkmark")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.tint)
                }
            }
            .padding(12)
            .background(Color.clElevated)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct NewThreadRow: View {
    let highlighted: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 12) {
                Image(systemName: "square.and.pencil")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.tint)
                    .frame(width: 28, height: 28)
                    .background(Color.accentColor.opacity(0.14))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("New thread")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.tint)
                    Text("Start a fresh conversation")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if highlighted {
                    Image(systemName: "checkmark")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.tint)
                }
            }
            .padding(12)
            .background(Color.clElevated)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.accentColor.opacity(highlighted ? 0.6 : 0.25), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct ThreadRow: View {
    let thread: ThreadRef
    let selected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 12) {
                Image(systemName: "bubble.left.and.text.bubble.right")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 28)
                    .background(Color.secondary.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                Text(thread.title ?? "Untitled thread")
                    .font(.callout)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Spacer()
                if selected {
                    Image(systemName: "checkmark")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.tint)
                }
            }
            .padding(12)
            .background(Color.clElevated)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Settings sheet

@available(iOS 17.0, macOS 14.0, *)
private struct SettingsSheet: View {
    let projection: CodexLinkProjection
    let connectionState: CodexLinkConnectionState
    let selection: CodexLinkSessionSelection
    let onAction: (CodexLinkUIAction) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var showRevokeConfirmation = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let host = selectedHost {
                        HostSummaryCard(host: host)
                    }

                    if connectionState != .connected && connectionState != .restored {
                        InlineBanner(
                            tint: ConnectionStyle.color(for: connectionState),
                            icon: ConnectionStyle.icon(for: connectionState),
                            title: ConnectionStyle.label(for: connectionState),
                            detail: nil
                        )
                    }

                    if let latestError = projection.latestError {
                        InlineBanner(
                            tint: .red,
                            icon: "exclamationmark.triangle.fill",
                            title: "Latest error",
                            detail: latestError,
                            onDismiss: { onAction(.dismissError) }
                        )
                    }

                    if !projection.diagnostics.isEmpty {
                        DiagnosticsCard(diagnostics: projection.diagnostics)
                    }

                    BuildInfoCard(connectionState: connectionState)

                    SettingsActionsCard(
                        onSwitchHost: {
                            onAction(.showHostSwitcher)
                            dismiss()
                        },
                        onRevoke: {
                            showRevokeConfirmation = true
                        }
                    )
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 32)
            }
            .background(Color.clGroupedBackground)
            .navigationTitle("Settings")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog(
                "Revoke this device?",
                isPresented: $showRevokeConfirmation,
                titleVisibility: .visible
            ) {
                Button("Revoke", role: .destructive) {
                    onAction(.revokeDeviceSession)
                    dismiss()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This iPhone will lose its pairing. You can re-pair from the Mac later.")
            }
        }
    }

    private var selectedHost: Host? {
        selection.hostId.flatMap { projection.hosts[$0] }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct HostSummaryCard: View {
    let host: Host

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(host.status == .online
                            ? Color.green.opacity(0.18)
                            : Color.secondary.opacity(0.14))
                        .frame(width: 52, height: 52)
                    Image(systemName: host.platform == "macos" ? "laptopcomputer" : "desktopcomputer")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(host.status == .online ? Color.green : Color.secondary)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(host.name)
                        .font(.title3.weight(.semibold))
                    HStack(spacing: 6) {
                        Circle()
                            .fill(host.status == .online ? Color.green : Color.secondary)
                            .frame(width: 7, height: 7)
                        Text(host.status == .online ? "Online" : "Offline")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
            }

            if let account = host.chatgptAccount {
                Divider()
                LabeledRow(label: "ChatGPT", value: account.email)
                if let plan = account.planType {
                    LabeledRow(label: "Plan", value: plan)
                }
            }
        }
        .padding(16)
        .background(Color.clElevated)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct LabeledRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct DiagnosticsCard: View {
    let diagnostics: [DiagnosticEvent]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Diagnostics")
                .font(.subheadline.weight(.semibold))
            VStack(alignment: .leading, spacing: 10) {
                ForEach(diagnostics) { diagnostic in
                    HStack(alignment: .top, spacing: 10) {
                        Circle()
                            .fill(color(for: diagnostic.severity))
                            .frame(width: 7, height: 7)
                            .padding(.top, 5)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(diagnostic.severity.rawValue.capitalized) · \(diagnostic.scope)")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(color(for: diagnostic.severity))
                            Text(diagnostic.message)
                                .font(.caption)
                                .foregroundStyle(.primary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.clElevated)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func color(for severity: DiagnosticSeverity) -> Color {
        switch severity {
        case .info: return .secondary
        case .warning: return .orange
        case .error: return .red
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct BuildInfoCard: View {
    let connectionState: CodexLinkConnectionState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Build / Connection")
                .font(.subheadline.weight(.semibold))
            LabeledRow(label: "Bundle", value: Self.bundleVersion)
            LabeledRow(label: "Launched", value: Self.launchedAtText)
            LabeledRow(label: "State", value: connectionState.rawValue)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.clElevated)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private static let bundleVersion: String = {
        let bundle = Bundle.main
        let short = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\(short) (\(build))"
    }()

    private static let launchedAt: Date = Date()
    private static let launchedAtText: String = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MM-dd HH:mm:ss"
        return formatter.string(from: launchedAt)
    }()
}

@available(iOS 17.0, macOS 14.0, *)
private struct SettingsActionsCard: View {
    let onSwitchHost: () -> Void
    let onRevoke: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onSwitchHost) {
                HStack(spacing: 12) {
                    Image(systemName: "arrow.left.arrow.right")
                        .frame(width: 24)
                    Text("Switch Host")
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Divider().padding(.leading, 50)

            Button(role: .destructive, action: onRevoke) {
                HStack(spacing: 12) {
                    Image(systemName: "trash")
                        .frame(width: 24)
                    Text("Revoke Device")
                    Spacer()
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.red)
        }
        .background(Color.clElevated)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

// MARK: - Shared bits

@available(iOS 17.0, macOS 14.0, *)
private struct SectionHeading: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .tracking(0.6)
            .padding(.horizontal, 4)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct InlineBanner: View {
    let tint: Color
    let icon: String
    let title: String
    let detail: String?
    var onDismiss: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.callout.weight(.semibold))
                .foregroundStyle(tint)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            if let onDismiss {
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss")
            }
        }
        .padding(12)
        .background(tint.opacity(0.12))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(tint.opacity(0.25), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

@available(iOS 17.0, macOS 14.0, *)
private extension Color {
    static var clBackground: Color {
        #if os(iOS)
        Color(uiColor: .systemBackground)
        #else
        Color(nsColor: .windowBackgroundColor)
        #endif
    }

    static var clGroupedBackground: Color {
        #if os(iOS)
        Color(uiColor: .systemGroupedBackground)
        #else
        Color(nsColor: .windowBackgroundColor)
        #endif
    }

    static var clElevated: Color {
        #if os(iOS)
        Color(uiColor: .secondarySystemGroupedBackground)
        #else
        Color(nsColor: .controlBackgroundColor)
        #endif
    }

    static var clElevatedAlt: Color {
        #if os(iOS)
        Color(uiColor: .secondarySystemBackground)
        #else
        Color(nsColor: .controlBackgroundColor)
        #endif
    }

    static var clTertiary: Color {
        #if os(iOS)
        Color(uiColor: .tertiarySystemBackground)
        #else
        Color.gray.opacity(0.12)
        #endif
    }

    static var clFill: Color {
        #if os(iOS)
        Color(uiColor: .tertiarySystemFill)
        #else
        Color.gray.opacity(0.15)
        #endif
    }
}

private enum ConnectionStyle {
    static func icon(for state: CodexLinkConnectionState) -> String {
        switch state {
        case .disconnected: return "wifi.slash"
        case .connecting: return "antenna.radiowaves.left.and.right"
        case .connected: return "wifi"
        case .reconnecting: return "arrow.triangle.2.circlepath"
        case .restoring: return "clock.arrow.circlepath"
        case .restored: return "checkmark.icloud"
        case .failed: return "exclamationmark.triangle.fill"
        }
    }

    static func label(for state: CodexLinkConnectionState) -> String {
        switch state {
        case .disconnected: return "Disconnected from Relay"
        case .connecting: return "Connecting to Relay…"
        case .connected: return "Connected"
        case .reconnecting: return "Reconnecting to Relay…"
        case .restoring: return "Restoring missed events…"
        case .restored: return "Reconnected"
        case .failed: return "Couldn't reach Relay"
        }
    }

    static func color(for state: CodexLinkConnectionState) -> Color {
        switch state {
        case .disconnected: return .secondary
        case .connecting, .reconnecting, .restoring: return .teal
        case .connected, .restored: return .green
        case .failed: return .red
        }
    }
}
