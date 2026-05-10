# Codex Link iPhone App

iPhone からローカル Host 上の Codex セッションを見て操作するネイティブアプリです。

通常体験の理想は、ほぼ ChatGPT の iPhone app です。
前回の conversation / thread を復元できる場合は会話画面へ戻し、Host 一覧は初回、切替、アクセス不能時の導線として扱います。

MVP で扱うもの:

- MVP device session / placeholder login
- Host pairing code による MVP HostAccess 付与
- 前回 conversation / thread の復元
- Host 一覧
- Project / Thread 選択
- ChatGPT app に近い conversation screen
- Prompt 送信
- 実行状態
- transcript
- timeline
- 承認 UI
- Live Activities
- 再接続後の表示復元

このアプリは SSH クライアントではありません。raw Codex app-server JSON-RPC も直接話しません。

## 現在の実装

まず UI から独立した SwiftPM module として iPhone 側の状態管理 core を置き、最小の Xcode app target / widget extension から import しています。

- `Sources/CodexLinkIOS/CodexLinkModels.swift`: Host / Project / Thread / Turn / transcript / timeline / approval / LiveActivityState の表示用 model。
- `Sources/CodexLinkIOS/RelayMessages.swift`: Relay から届く `host.event` と Codex Link event の decode。
- `Sources/CodexLinkIOS/RelayCommands.swift`: Host へ送る `codex.turn.start` / `codex.turn.steer` / `codex.turn.interrupt` / `codex.thread.restore` command。
- `Sources/CodexLinkIOS/DeviceSession.swift`: MVP placeholder login と Host pairing code redeem 用の iPhone device session client。
- `Sources/CodexLinkIOS/SessionProjection.swift`: event stream から transcript、timeline、approval、LiveActivityState を復元する projection。
- `Sources/CodexLinkIOS/CodexLinkUIState.swift`: UI selection、connection state、UI action。
- `Sources/CodexLinkIOS/CodexLinkRootView.swift`: Host list、Project / Thread drawer、conversation screen、composer、timeline、approval UI。
- `Sources/CodexLinkIOS/RelayActionEncoder.swift`: UI action を Relay message へ変換する encoder。turn、restore、approval decision を扱う。
- `Sources/CodexLinkIOS/RelayWebSocketClient.swift`: iPhone から Relay へ接続し、Host event cache を購読して visible session を復元する WebSocket client。
- `Sources/CodexLinkIOS/SessionRestore.swift`: 前回 Host / Project / Thread と Relay sequence から表示状態を復元する core。
- `Sources/CodexLinkIOS/SessionStartup.swift`: 保存済み bookmark を読み、起動時に前回 session へ戻す startup restore core。
- `Sources/CodexLinkIOS/AppLifecycle.swift`: 実 app target 用の lifecycle view model。device session 登録、startup restore、Relay receive loop、UI action binding を扱う。
- `Sources/CodexLinkIOS/LiveActivity.swift`: ActivityKit attributes、Live Activity start/update/end controller、WidgetKit 表示、active turn deep link。
- `Sources/CodexLinkIOS/CodexLinkPreviewCanvas.swift`: Xcode Preview で開発中 UI をその場で見るための canvas。
- `CodexLink.xcodeproj`: iOS app target `CodexLinkApp` と Live Activity widget extension `CodexLinkWidgets`。
- `App/CodexLinkApp`: `CodexLinkRootView` を表示し、Relay lifecycle、Live Activity sync、`codexlink://thread?...` deep link を接続する app target。
- `App/CodexLinkWidgets`: `CodexLinkTurnLiveActivityWidget` を登録する widget extension bundle。

## コマンド

```bash
cd apps/ios
swift test
xcodebuild -workspace .swiftpm/xcode/package.xcworkspace -scheme CodexLinkIOS -destination 'generic/platform=iOS' build
xcodebuild -project CodexLink.xcodeproj -scheme CodexLinkApp -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
```

`CodexLinkApp` の dev Relay 設定は `App/CodexLinkApp/Info.plist` の `CodexLinkRelayURL` です。現在の既定値は Simulator 向けの `http://127.0.0.1:3000` です。
実機で動かす場合は、iPhone から到達できる Relay URL に変更してください。

新規 iPhone device session は、Mac Host 起動時に表示される短命 pairing code を Host picker の `Pair Host` へ入力すると、Relay の `/api/device-session/pair` で既存 HostAccess を受け取り、その Host の event cache を購読します。
これは MVP placeholder pairing です。本物の multi-user authentication、device revocation、ACL sharing は Phase 7 で扱います。
リアルタイム確認は、Xcode で `Package.swift` を開き、`CodexLinkPreviewCanvas.swift` の `#Preview` を表示すると使えます。
Preview は conversation approval、running、Host picker、reconnecting、offline の状態を切り替えて確認できます。
