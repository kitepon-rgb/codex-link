import SwiftUI

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
                HostPickerView(
                    hosts: sortedHosts,
                    projectsByHost: projection.projectsByHost,
                    connectionState: connectionState,
                    latestError: projection.latestError,
                    select: selectHost,
                    pair: pairHost
                )
            } else {
                SessionScreen(
                    projection: projection,
                    connectionState: connectionState,
                    selection: $selection,
                    onAction: onAction
                )
            }
        }
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
        guard let hostId = selection.hostId else {
            return true
        }
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

@available(iOS 17.0, macOS 14.0, *)
private struct HostPickerView: View {
    let hosts: [Host]
    let projectsByHost: [String: [ProjectRef]]
    let connectionState: CodexLinkConnectionState
    let latestError: String?
    let select: (Host) -> Void
    let pair: (String) -> Void

    @State private var pairingCode = ""
    @State private var isPresentingScanner = false
    @State private var scannerError: String?

    var body: some View {
        List {
            if connectionState != .connected || latestError != nil {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        StatusPill(
                            text: connectionText,
                            icon: connectionIcon,
                            color: connectionColor
                        )
                        if let latestError {
                            Text(latestError)
                                .font(.footnote)
                                .foregroundStyle(.red)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            Section("Pair Host") {
                #if os(iOS)
                Button {
                    scannerError = nil
                    isPresentingScanner = true
                } label: {
                    Label("Scan QR from Mac", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityLabel("Scan pairing QR")
                if let scannerError {
                    Text(scannerError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                }
                #endif
                DisclosureGroup("Enter code manually") {
                    HStack(spacing: 10) {
                        TextField("Pairing code", text: $pairingCode)
                            #if os(iOS)
                            .textInputAutocapitalization(.characters)
                            .keyboardType(.asciiCapable)
                            #endif
                        Button {
                            let code = pairingCode.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !code.isEmpty else {
                                return
                            }
                            pair(code)
                            pairingCode = ""
                        } label: {
                            Image(systemName: "link.badge.plus")
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(pairingCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityLabel("Pair Host")
                    }
                }
            }
            #if os(iOS)
            .sheet(isPresented: $isPresentingScanner) {
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
            ForEach(hosts) { host in
                Button {
                    select(host)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: host.status == .online ? "desktopcomputer" : "desktopcomputer.trianglebadge.exclamationmark")
                            .foregroundStyle(host.status == .online ? .green : .secondary)
                            .frame(width: 28)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(host.name)
                                .font(.headline)
                                .foregroundStyle(.primary)
                            Text(projectSummary(for: host.id))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        Text(host.status.rawValue)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
            }
        }
        .navigationTitle("Codex Link")
    }

    private func projectSummary(for hostId: String) -> String {
        let projects = projectsByHost[hostId] ?? []
        guard let first = projects.first else {
            return "No projects"
        }
        if projects.count == 1 {
            return first.name
        }
        return "\(first.name) + \(projects.count - 1)"
    }

    private var connectionText: String {
        switch connectionState {
        case .disconnected:
            return "Disconnected"
        case .connecting:
            return "Connecting"
        case .connected:
            return "Connected"
        case .reconnecting:
            return "Reconnecting"
        case .restoring:
            return "Restoring"
        case .restored:
            return "Restored"
        case .failed:
            return "Connection failed"
        }
    }

    private var connectionIcon: String {
        switch connectionState {
        case .disconnected:
            return "wifi.slash"
        case .connecting:
            return "antenna.radiowaves.left.and.right"
        case .connected:
            return "wifi"
        case .reconnecting:
            return "arrow.triangle.2.circlepath"
        case .restoring:
            return "clock.arrow.circlepath"
        case .restored:
            return "checkmark.icloud"
        case .failed:
            return "exclamationmark.triangle"
        }
    }

    private var connectionColor: Color {
        switch connectionState {
        case .disconnected:
            return .secondary
        case .connecting, .reconnecting, .restoring:
            return .teal
        case .connected, .restored:
            return .green
        case .failed:
            return .red
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct SessionScreen: View {
    let projection: CodexLinkProjection
    let connectionState: CodexLinkConnectionState
    @Binding var selection: CodexLinkSessionSelection
    let onAction: (CodexLinkUIAction) -> Void

    @State private var draft = ""
    @State private var showTimeline = false
    @State private var showThreadDrawer = false
    @State private var showInspector = false

    var body: some View {
        VStack(spacing: 0) {
            StatusStrip(
                host: selectedHost,
                connectionState: connectionState,
                status: currentStatus,
                latestActivity: latestActivity,
                latestError: projection.latestError
            )
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        ForEach(visibleTranscript) { item in
                            TranscriptBubble(item: item)
                                .id(item.id)
                        }
                        if showTimeline, !visibleTimeline.isEmpty {
                            TimelinePanel(items: visibleTimeline)
                        }
                        ForEach(visibleApprovals) { request in
                            ApprovalPanel(request: request, onAction: onAction)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 18)
                }
                .onChange(of: visibleTranscript.last?.id) { _, itemId in
                    guard let itemId else {
                        return
                    }
                    withAnimation(.snappy) {
                        proxy.scrollTo(itemId, anchor: .bottom)
                    }
                }
            }
            ComposerBar(
                text: $draft,
                isRunning: isRunning,
                hasTimeline: !visibleTimeline.isEmpty,
                showTimeline: $showTimeline,
                send: sendDraft,
                interrupt: interrupt
            )
        }
        .navigationTitle(title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showInspector = true
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Inspector")
            }
            ToolbarItem(placement: .cancellationAction) {
                Button {
                    showThreadDrawer = true
                } label: {
                    Image(systemName: "sidebar.left")
                }
                .accessibilityLabel("Threads")
            }
        }
        .sheet(isPresented: $showThreadDrawer) {
            ThreadDrawer(
                projects: selectedHostProjects,
                threads: sortedThreads,
                selection: $selection,
                onAction: onAction
            )
        }
        .sheet(isPresented: $showInspector) {
            InspectorView(
                projection: projection,
                connectionState: connectionState,
                selection: selection,
                onAction: onAction
            )
        }
    }

    private var selectedHost: Host? {
        selection.hostId.flatMap { projection.hosts[$0] }
    }

    private var selectedHostProjects: [ProjectRef] {
        guard let hostId = selection.hostId else {
            return []
        }
        return projection.projectsByHost[hostId] ?? []
    }

    private var title: String {
        if let threadId = selection.threadId, let thread = projection.threads[threadId], let title = thread.title {
            return title
        }
        if let projectId = selection.projectId,
           let project = selectedHostProjects.first(where: { $0.id == projectId }) {
            return project.name
        }
        return selectedHost?.name ?? "Codex Link"
    }

    private var visibleTranscript: [TranscriptItem] {
        guard let threadId = selection.threadId else {
            return projection.transcript
        }
        return projection.transcript.filter { $0.threadId == threadId }
    }

    private var visibleTimeline: [TimelineItem] {
        guard let threadId = selection.threadId else {
            return projection.timeline
        }
        return projection.timeline.filter { $0.threadId == threadId }
    }

    private var visibleApprovals: [ApprovalRequest] {
        guard let threadId = selection.threadId else {
            return projection.approvals
        }
        return projection.approvals.filter { $0.threadId == threadId }
    }

    private var sortedThreads: [ThreadRef] {
        projection.threads.values.sorted { first, second in
            (first.title ?? first.id).localizedCaseInsensitiveCompare(second.title ?? second.id) == .orderedAscending
        }
    }

    private var activeTurnId: String? {
        selection.activeTurnId
            ?? visibleApprovals.last?.turnId
            ?? visibleTimeline.last?.turnId
            ?? visibleTranscript.last?.turnId
    }

    private var currentStatus: TurnStatus {
        guard let activeTurnId else {
            return .idle
        }
        return projection.turnStatus[activeTurnId] ?? .idle
    }

    private var latestActivity: TimelineItem? {
        guard let activeTurnId else {
            return visibleTimeline.last
        }
        return visibleTimeline.last(where: { $0.turnId == activeTurnId }) ?? visibleTimeline.last
    }

    private var isRunning: Bool {
        currentStatus == .running || currentStatus == .waitingForApproval
    }

    private func sendDraft() {
        let prompt = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else {
            return
        }

        if isRunning {
            guard let threadId = selection.threadId, let turnId = activeTurnId else {
                onAction(.unsupportedOperation(reason: "running turn is missing thread or turn id"))
                return
            }
            onAction(.steerPrompt(threadId: threadId, turnId: turnId, prompt: prompt))
        } else {
            guard let projectId = selection.projectId else {
                onAction(.unsupportedOperation(reason: "project is not selected"))
                return
            }
            onAction(.sendPrompt(projectId: projectId, threadId: selection.threadId, prompt: prompt))
        }
        draft = ""
    }

    private func interrupt() {
        guard let threadId = selection.threadId, let turnId = activeTurnId else {
            onAction(.unsupportedOperation(reason: "running turn is missing thread or turn id"))
            return
        }
        onAction(.interrupt(threadId: threadId, turnId: turnId))
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct StatusStrip: View {
    let host: Host?
    let connectionState: CodexLinkConnectionState
    let status: TurnStatus
    let latestActivity: TimelineItem?
    let latestError: String?

    var body: some View {
        HStack(spacing: 8) {
            Label(hostStatusText, systemImage: hostIcon)
                .foregroundStyle(hostColor)
                .lineLimit(1)
            if connectionState != .connected {
                StatusPill(
                    text: connectionText,
                    icon: connectionIcon,
                    color: connectionColor
                )
            }
            StatusPill(text: statusText, icon: statusIcon, color: statusColor)
            if let latestActivity {
                Label(latestActivity.label, systemImage: activityIcon(for: latestActivity.status))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            if let latestError {
                Text(latestError)
                    .lineLimit(1)
                    .foregroundStyle(.red)
            }
            Spacer()
        }
        .font(.caption)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.thinMaterial)
    }

    private var hostIcon: String {
        host?.status == .online ? "checkmark.circle.fill" : "exclamationmark.circle"
    }

    private var hostColor: Color {
        host?.status == .online ? .green : .secondary
    }

    private var hostStatusText: String {
        guard let host else {
            return "No host"
        }
        return host.name
    }

    private var connectionText: String {
        switch connectionState {
        case .disconnected:
            return "Disconnected"
        case .connecting:
            return "Connecting"
        case .connected:
            return "Connected"
        case .reconnecting:
            return "Reconnecting"
        case .restoring:
            return "Restoring"
        case .restored:
            return "Restored"
        case .failed:
            return "Connection failed"
        }
    }

    private var connectionIcon: String {
        switch connectionState {
        case .disconnected:
            return "wifi.slash"
        case .connecting:
            return "antenna.radiowaves.left.and.right"
        case .connected:
            return "wifi"
        case .reconnecting:
            return "arrow.triangle.2.circlepath"
        case .restoring:
            return "clock.arrow.circlepath"
        case .restored:
            return "checkmark.icloud"
        case .failed:
            return "exclamationmark.triangle"
        }
    }

    private var connectionColor: Color {
        switch connectionState {
        case .disconnected:
            return .secondary
        case .connecting, .reconnecting, .restoring:
            return .teal
        case .connected, .restored:
            return .green
        case .failed:
            return .red
        }
    }

    private var statusText: String {
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

    private var statusIcon: String {
        switch status {
        case .idle:
            return "circle"
        case .running:
            return "sparkle"
        case .waitingForApproval:
            return "hand.raised.fill"
        case .completed:
            return "checkmark"
        case .failed:
            return "xmark"
        case .canceled:
            return "stop.fill"
        }
    }

    private var statusColor: Color {
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

    private func activityIcon(for status: TimelineStatus) -> String {
        switch status {
        case .running:
            return "gearshape.2"
        case .completed:
            return "checkmark.circle"
        case .failed:
            return "xmark.circle"
        case .declined:
            return "nosign"
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct StatusPill: View {
    let text: String
    let icon: String
    let color: Color

    var body: some View {
        Label(text, systemImage: icon)
            .lineLimit(1)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct TranscriptBubble: View {
    let item: TranscriptItem

    var body: some View {
        HStack {
            if item.role == .user {
                Spacer(minLength: 40)
            }
            Text(item.text)
                .font(.body)
                .textSelection(.enabled)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(background)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .frame(maxWidth: 620, alignment: item.role == .user ? .trailing : .leading)
            if item.role == .assistant {
                Spacer(minLength: 40)
            }
        }
        .frame(maxWidth: .infinity, alignment: item.role == .user ? .trailing : .leading)
    }

    private var background: Color {
        item.role == .user ? Color.accentColor.opacity(0.16) : Color.secondary.opacity(0.10)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct TimelinePanel: View {
    let items: [TimelineItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(items) { item in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: icon(for: item.status))
                        .foregroundStyle(color(for: item.status))
                        .frame(width: 20)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.label)
                            .lineLimit(2)
                        if let detail = item.detail, !detail.isEmpty {
                            Text(detail)
                                .font(.caption2.monospaced())
                                .lineLimit(10)
                                .textSelection(.enabled)
                        }
                    }
                    Spacer()
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func icon(for status: TimelineStatus) -> String {
        switch status {
        case .running:
            return "circle.dotted"
        case .completed:
            return "checkmark.circle"
        case .failed:
            return "xmark.circle"
        case .declined:
            return "nosign"
        }
    }

    private func color(for status: TimelineStatus) -> Color {
        switch status {
        case .running:
            return .teal
        case .completed:
            return .green
        case .failed:
            return .red
        case .declined:
            return .orange
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct ApprovalPanel: View {
    let request: ApprovalRequest
    let onAction: (CodexLinkUIAction) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(request.title, systemImage: icon)
                .font(.headline)
            Text(request.detail)
                .font(.callout)
                .textSelection(.enabled)
                .foregroundStyle(.secondary)
            HStack {
                ForEach(request.availableDecisions, id: \.self) { decision in
                    Button(label(for: decision)) {
                        onAction(.approvalDecision(requestId: request.id, decision: decision))
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
        .padding(14)
        .background(Color.orange.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var icon: String {
        switch request.kind {
        case .commandExecution:
            return "terminal"
        case .fileChange:
            return "doc.badge.gearshape"
        case .network:
            return "network"
        case .userInput:
            return "questionmark.bubble"
        }
    }

    private func label(for decision: ApprovalDecisionKind) -> String {
        switch decision {
        case .accept:
            return "Allow"
        case .acceptForSession:
            return "Allow Session"
        case .decline:
            return "Deny"
        case .cancel:
            return "Cancel"
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct ComposerBar: View {
    @Binding var text: String
    let isRunning: Bool
    let hasTimeline: Bool
    @Binding var showTimeline: Bool
    let send: () -> Void
    let interrupt: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            Button {
                showTimeline.toggle()
            } label: {
                Image(systemName: showTimeline ? "list.bullet.rectangle.fill" : "list.bullet.rectangle")
            }
            .disabled(!hasTimeline)
            .accessibilityLabel("Timeline")

            TextField("Message", text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...5)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color.secondary.opacity(0.10))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            if isRunning {
                Button(action: interrupt) {
                    Image(systemName: "stop.fill")
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .accessibilityLabel("Stop")
            }

            Button(action: send) {
                Image(systemName: "arrow.up")
            }
            .buttonStyle(.borderedProminent)
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.regularMaterial)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct ThreadDrawer: View {
    let projects: [ProjectRef]
    let threads: [ThreadRef]
    @Binding var selection: CodexLinkSessionSelection
    let onAction: (CodexLinkUIAction) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Projects") {
                    ForEach(projects) { project in
                        Button {
                            selection.projectId = project.id
                            selection.threadId = nil
                            selection.activeTurnId = nil
                            onAction(.selectProject(projectId: project.id))
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(project.name)
                                Text(project.pathLabel)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
                Section("Threads") {
                    ForEach(threadsForSelectedProject) { thread in
                        Button {
                            selection.threadId = thread.id
                            selection.projectId = thread.projectId
                            selection.activeTurnId = nil
                            onAction(.restoreThread(projectId: thread.projectId, threadId: thread.id))
                            dismiss()
                        } label: {
                            Text(thread.title ?? "Untitled")
                                .lineLimit(1)
                        }
                    }
                }
            }
            .navigationTitle("Sessions")
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
private struct InspectorView: View {
    let projection: CodexLinkProjection
    let connectionState: CodexLinkConnectionState
    let selection: CodexLinkSessionSelection
    let onAction: (CodexLinkUIAction) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var showRevokeConfirmation = false

    var body: some View {
        NavigationStack {
            List {
                Section("Connection") {
                    LabeledContent("State", value: connectionState.rawValue)
                    if let host = selectedHost {
                        LabeledContent("Host", value: host.name)
                        LabeledContent("Host status", value: host.status.rawValue)
                    }
                    if let latestError = projection.latestError {
                        Text(latestError)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Section("Selection") {
                    InspectorValueRow(label: "Host", value: selection.hostId)
                    InspectorValueRow(label: "Project", value: selection.projectId)
                    InspectorValueRow(label: "Thread", value: selection.threadId)
                    InspectorValueRow(label: "Turn", value: selection.activeTurnId)
                }

                Section("Diagnostics") {
                    if projection.diagnostics.isEmpty {
                        Text("None")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(projection.diagnostics) { diagnostic in
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(diagnostic.severity.rawValue) · \(diagnostic.scope)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(diagnostic.message)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }

                Section("Actions") {
                    Button {
                        onAction(.showHostSwitcher)
                        dismiss()
                    } label: {
                        Label("Switch Host", systemImage: "desktopcomputer")
                    }

                    Button(role: .destructive) {
                        showRevokeConfirmation = true
                    } label: {
                        Label("Revoke Device", systemImage: "trash")
                    }
                }
            }
            .navigationTitle("Inspector")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .confirmationDialog(
                "Revoke Device",
                isPresented: $showRevokeConfirmation,
                titleVisibility: .visible
            ) {
                Button("Revoke Device", role: .destructive) {
                    onAction(.revokeDeviceSession)
                    dismiss()
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private var selectedHost: Host? {
        selection.hostId.flatMap { projection.hosts[$0] }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct InspectorValueRow: View {
    let label: String
    let value: String?

    var body: some View {
        LabeledContent(label) {
            Text(value ?? "None")
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(value == nil ? .secondary : .primary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}
