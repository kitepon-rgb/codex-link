# `@codex-link/codex-client`

Host app から Codex app-server と通信するための client 層を置く package です。

責務:

- `codex app-server` の起動または接続
- `initialize` / `initialized` handshake
- `thread/start` / `turn/start`
- `turn/steer` / `turn/interrupt`
- app-server notifications の購読
- approval request への応答
- Codex app-server event から Codex Link event への変換補助

生成型:

- `src/generated/codex-app-server/` に `codex app-server generate-ts --experimental` の生成物を置きます。

## 現在の実装

- `CodexAppServerStdioClient`: `codex app-server` を stdio JSONL で起動し、JSON-RPC request / response を扱う client。
- `initialize()`: `initialize` request を送り、成功後に `initialized` notification を送る。
- `startThread()` / `startTurn()` / `steerTurn()` / `interruptTurn()`: Host 側の最小セッション操作で使う app-server request helper。
- `listModels()` / `listExperimentalFeatures()` / `readConfig()`: iPhone UI と Host capabilities 用の app-server metadata request helper。
- `listThreads()` / `readThread()` / `listThreadTurns()`: reconnect 後の transcript / timeline 復元用 request helper。
- `onNotification` / `onServerRequest`: app-server notification と approval などの server-initiated request を受け取る hook。

## コマンド

```bash
pnpm --filter @codex-link/codex-client typecheck
pnpm --filter @codex-link/codex-client test
```
