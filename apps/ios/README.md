# Codex Link iPhone App

iPhone からローカル Host 上の Codex セッションを見て操作するネイティブアプリです。

通常体験の理想は、ほぼ ChatGPT の iPhone app です。
前回の conversation / thread を復元できる場合は会話画面へ戻し、Host 一覧は初回、切替、アクセス不能時の導線として扱います。

MVP で扱うもの:

- MVP device session / placeholder login
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

まず UI から独立した SwiftPM module として、iPhone 側の状態管理 core を置いています。

- `Sources/CodexLinkIOS/CodexLinkModels.swift`: Host / Project / Thread / Turn / transcript / timeline / approval / LiveActivityState の表示用 model。
- `Sources/CodexLinkIOS/RelayMessages.swift`: Relay から届く `host.event` と Codex Link event の decode。
- `Sources/CodexLinkIOS/RelayCommands.swift`: Host へ送る `codex.turn.start` / `codex.turn.steer` / `codex.turn.interrupt` / `codex.thread.restore` command。
- `Sources/CodexLinkIOS/SessionProjection.swift`: event stream から transcript、timeline、approval、LiveActivityState を復元する projection。
- `Sources/CodexLinkIOS/CodexLinkUIState.swift`: UI selection と UI action。
- `Sources/CodexLinkIOS/CodexLinkRootView.swift`: Host list、Project / Thread drawer、conversation screen、composer、timeline、approval UI。
- `Sources/CodexLinkIOS/RelayActionEncoder.swift`: UI action を Relay message へ変換する encoder。turn、restore、approval decision を扱う。
- `Sources/CodexLinkIOS/RelayWebSocketClient.swift`: iPhone から Relay へ接続する WebSocket client skeleton。
- `Sources/CodexLinkIOS/SessionRestore.swift`: 前回 Host / Project / Thread と Relay sequence から表示状態を復元する core。
- `Sources/CodexLinkIOS/CodexLinkPreviewCanvas.swift`: Xcode Preview で開発中 UI をその場で見るための canvas。

## コマンド

```bash
cd apps/ios
swift test
```

Xcode app target は次の段階で追加します。
リアルタイム確認は、Xcode で `Package.swift` を開き、`CodexLinkPreviewCanvas.swift` の `#Preview` を表示すると使えます。
Preview は conversation approval、running、Host picker、offline の状態を切り替えて確認できます。
