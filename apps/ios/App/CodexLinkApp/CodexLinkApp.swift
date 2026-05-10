import CodexLinkIOS
import SwiftUI
import UIKit

@available(iOS 17.0, *)
@main
struct CodexLinkApp: App {
    @StateObject private var model: CodexLinkAppViewModel

    private let liveActivityController = CodexLinkLiveActivityController()

    init() {
        switch CodexLinkAppConfigurationLoader.load() {
        case .success(let configuration):
            _model = StateObject(wrappedValue: CodexLinkAppViewModel(configuration: configuration))
        case .failure(let message):
            _model = StateObject(wrappedValue: CodexLinkAppViewModel(
                configurationErrorMessage: message
            ))
        }
    }

    var body: some Scene {
        WindowGroup {
            CodexLinkRootView(
                projection: model.projection,
                connectionState: model.connectionState,
                selection: Binding(
                    get: { model.selection },
                    set: { model.updateSelection($0) }
                ),
                onAction: model.handle
            )
            .task {
                model.start()
            }
            .task(id: liveActivitySyncID) {
                await syncLiveActivity()
            }
            .onOpenURL { url in
                model.openDeepLink(url)
            }
        }
    }

    private var liveActivitySyncID: String {
        [
            model.selection.hostId,
            model.selection.projectId,
            model.selection.threadId,
            model.selection.activeTurnId,
            model.selection.activeTurnId.flatMap { model.projection.turnStatus[$0]?.rawValue },
            String(model.projection.approvals.count),
            model.projection.transcript.last?.id,
        ]
        .map { $0 ?? "" }
        .joined(separator: "|")
    }

    private func syncLiveActivity() async {
        do {
            _ = try await liveActivityController.sync(
                projection: model.projection,
                selection: model.selection
            )
        } catch {
            print("CodexLink Live Activity sync failed: \(error)")
        }
    }
}

@MainActor
private enum CodexLinkAppConfigurationLoader {
    enum LoadResult {
        case success(CodexLinkAppRuntimeConfiguration)
        case failure(String)
    }

    static func load(bundle: Bundle = .main) -> LoadResult {
        guard let relayURLValue = bundle.object(forInfoDictionaryKey: "CodexLinkRelayURL") as? String,
              !relayURLValue.isEmpty
        else {
            return .failure("CodexLinkRelayURL is missing from Info.plist.")
        }
        guard let relayURL = URL(string: relayURLValue) else {
            return .failure("CodexLinkRelayURL is invalid: \(relayURLValue)")
        }
        guard let displayName = bundle.object(forInfoDictionaryKey: "CodexLinkDisplayName") as? String,
              !displayName.isEmpty
        else {
            return .failure("CodexLinkDisplayName is missing from Info.plist.")
        }
        return .success(CodexLinkAppRuntimeConfiguration(
            relayURL: relayURL,
            displayName: displayName,
            deviceName: UIDevice.current.name
        ))
    }
}
