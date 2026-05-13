# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリの概要

Codex Link は、iPhone app からユーザー自身の Mac/PC 上で動く Codex CLI / `app-server` を操作するためのシステム。3 つの面で構成する: `apps/ios` (ネイティブ iPhone app)、`apps/mac-host` (ローカル Codex 連携と副作用を所有する macOS Host)、`services/relay` (マルチテナント broker / registry / router、Codex 実行サーバではない)。共有コードは `packages/protocol` (wire 型) と `packages/codex-client` (Codex `app-server` client + 生成 binding) に置く。

仕様は `docs/` にある。読み順: `requirements.md` → `architecture.md` → `security-model.md` → `mvp-plan.md`。第三者仕様 (Codex `app-server` など) のスナップショットは `rag/third-party/` に置く。

## 守るべきアーキテクチャ規則

`AGENTS.md` / `CONTRIBUTING.md` / `docs/` で決めた規則。これらは設計の土台なので崩さない。

- Relay は broker のみ。Codex を実行しない、project folder を読まない、SSH 鍵を持たない、`~/.codex` を持たない、Codex thread/session の正本にならない。
- Host がローカル Codex 連携とローカル副作用 (filesystem、shell、Xcode、Docker など) をすべて所有する。
- iPhone app は raw Codex `app-server` JSON-RPC を直接話さない。`packages/protocol` の Codex Link protocol だけを話す。Host 専用の Codex 詳細を iPhone app に持ち込まない。
- iPhone app は SSH client ではなく、project folder を直接読まない。
- Relay はグローバル Host 一覧を返さない。すべての routing / listing で、現在の user の `HostAccess` を確認する。
- Relay は自宅 LAN 上で動かす場合でも、公開されたマルチテナントサービスとして扱う。単一の共有 API token は使わず、credential は device ごとで取り消し可能、Relay は token 本体ではなく SHA-256 hash だけを保存する。
- 共有 / 本番環境の Relay は Docker コンテナとしてデプロイする。サーバーへ Node.js アプリを直置きする経路は作らない。
- MVP の Host 側 Codex 入口は **loopback WebSocket app-server** (`codex app-server --listen ws://127.0.0.1:0`)。Mac Host が起動時に spawn し、自身は WS client として接続する。port は `$TMPDIR/codex-link-app-server.json` に書き出され、`apps/mac-host/scripts/codex-link-cli-attach.sh` 経由で `codex tui --remote ws://127.0.0.1:<port>` として接続することで CLI 側も同じ app-server に乗って live 同期できる。VS Code Codex 拡張が起動中は `$TMPDIR/codex-ipc/ipc-$UID.sock` の Unix domain socket に follower として接続して、拡張内蔵 app-server に turn を投げる経路を優先する (`thread-follower-start-turn` + broadcast `thread-stream-state-changed` を CodexLinkEvent に変換して iPhone へ転送)。`codex remote-control` は追跡対象だが enrollment が HTTP 404 (2026-05-10 時点) のため既定入口にしない。Relay は unauthenticated `app-server` WebSocket を外部公開しない (loopback bind のみ)。
- MVP Relay は broker-readable: command payload は transient で保存しない、event payload は再接続用の bounded per-Host event cache だけに置く。E2E privacy は未実装なので主張しない。
- 永続的なコード状態は GitHub を通す (branch / commit / PR / issue / docs)。別の永続化チャネルを追加しない。
- turn が `running` の間、iPhone composer は `codex.turn.steer` を送る (ユーザーには「次のメッセージを送る」として見せる)。新規 turn を作らない。Stop / interrupt は composer 付近の固定位置に置く。
- transcript と timeline は別 projection。診断 (`warning`、`deprecationNotice`、`mcpServer/startupStatus/updated`) は別 diagnostic projection に分け、ユーザー向け transcript / timeline に混ぜない。

新しい設計判断を入れたら、関連する `docs/` を同じ変更で更新する。関係ないドキュメントを大きく書き換えない。

## 開発コマンド

TypeScript workspace は `pnpm` を使う (`pnpm-workspace.yaml`)。workspace package: `@codex-link/protocol`、`@codex-link/codex-client`、`@codex-link/relay`、`@codex-link/mac-host`。

```bash
pnpm install
pnpm typecheck                # 全 workspace package で tsc --noEmit
pnpm test                     # 全 workspace package で vitest run
pnpm build                    # 全 build (実 emit は relay のみ、他は tsc --noEmit)
```

package ごと (`--filter` を使う):

```bash
pnpm --filter @codex-link/relay test
pnpm --filter @codex-link/relay typecheck
pnpm --filter @codex-link/relay build      # services/relay/dist へ emit
pnpm --filter @codex-link/mac-host start -- ~/.codex-link/host.json
```

vitest を file 単位 / test 単位で実行する場合:

```bash
pnpm --filter @codex-link/relay exec vitest run test/websocket.test.ts
pnpm --filter @codex-link/relay exec vitest run -t "rejects revoked device"
```

ローカル Relay (推奨は Docker、compose は `127.0.0.1:3000` だけに公開):

```bash
docker-compose up --build relay
```

Mac Host install と起動 (`~/.codex-link/host.json` を書き、device token を macOS Keychain に保存し、起動時に一回限りの pairing code を表示する):

```bash
CODEX_LINK_RELAY_URL=http://127.0.0.1:3000 \
CODEX_LINK_HOST_BOOTSTRAP_TOKEN=codex-link-local-dev-bootstrap-token \
CODEX_LINK_PROJECT_PATH="$PWD" \
apps/mac-host/scripts/install.sh
pnpm --filter @codex-link/mac-host start -- ~/.codex-link/host.json
```

Codex `app-server` smoke script (ローカルの `codex` CLI が必要、log は `tmp/codex-app-server-smoke/` に出る):

```bash
node scripts/codex-app-server-smoke.mjs --turn
node scripts/codex-app-server-smoke.mjs --steer-smoke
node scripts/codex-app-server-smoke.mjs --interrupt-smoke
node scripts/codex-app-server-smoke.mjs --approval-smoke
node scripts/codex-app-server-ws-smoke.mjs
```

iOS (SwiftPM core + Xcode app target + widget extension):

```bash
cd apps/ios
swift test                                                                                # CodexLinkIOS unit test
xcodebuild -workspace .swiftpm/xcode/package.xcworkspace -scheme CodexLinkIOS \
  -destination 'generic/platform=iOS' build                                               # core module
xcodebuild -project CodexLink.xcodeproj -scheme CodexLinkApp \
  -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO             # app target
```

iOS UI を触る時は Xcode で `Package.swift` を開き、`Sources/CodexLinkIOS/CodexLinkPreviewCanvas.swift` の `#Preview` を使う (Host picker / running / approval / reconnecting / offline 状態が揃っている)。app target が向く dev Relay URL は `App/CodexLinkApp/Info.plist` の `CodexLinkRelayURL` (Simulator 既定は `http://127.0.0.1:3000`)。

## 触る前に把握しておきたい全体フロー

pairing から turn 実行までは 3 つの面すべてを通る。一度理解しておくと作業が速い:

1. Mac Host installer が `POST /api/host-bootstrap` に bootstrap token を付けて接続。Relay は `userId` / `deviceId` / `deviceToken` / `hostId` を返す。token は macOS Keychain へ、`host.json` には Keychain reference だけ書き、`chmod 600` を強制する (Host runtime は group / others readable な config を拒否)。
2. Host は `Authorization: Bearer <deviceToken>` 付きで Relay へ outbound WSS を張り、`host.pairingCode.create` を送る。Relay は短命かつ一回限りの code を返す。
3. iPhone は `POST /api/device-session` で placeholder device session を作り bearer を Keychain に保存、`POST /api/device-session/pair` で code を redeem する。Relay は `operator` `HostAccess` を付与する (既存 `owner` は降格しない)。
4. iPhone は `client.subscribeHost { afterSequence }` で購読を開始。Relay はその sequence の続きの cached event を replay してから `host.subscription.ready` を返す。要求 sequence が cache から落ちている場合は `HOST_EVENT_CACHE_GAP` を返すので、UI では接続失敗として扱い、決して成功扱いにしない。
5. iPhone は `client.toHost` で command を送る。Host は Codex `app-server` JSON-RPC に変換し、response / notification を `CodexLinkEvent` (`packages/protocol/src/index.ts`) へ正規化して `host.event` として Relay 経由で返す。承認 (`command_execution`、`file_change`、`network`、`user_input`) は `approval.requested` → user 判断 → `approval.resolved` で流れる。

実装の在処:

- wire 型と `CodexLinkEvent` union: `packages/protocol/src/index.ts`。
- Relay HTTP / WS surface、ACL filter、audit metadata、rate limit、payload size limit: `services/relay/src/{relay,websocket,state,config}.ts`。test は `services/relay/test/`。
- Host 側 Codex 連携: `apps/mac-host/src/{config,capabilities,codex,codex-events,session,relay-client,cli}.ts`。`codex-events.ts` が正規化の正本。新しい Codex `app-server` event を追加する時は、iPhone 側ではなくここに足す。
- iPhone core (UI 非依存の SwiftPM module。Xcode app / widget target から import): `apps/ios/Sources/CodexLinkIOS/`。主要 file: `RelayMessages.swift`、`RelayCommands.swift`、`SessionProjection.swift` (transcript / timeline / approval / LiveActivityState)、`RelayWebSocketClient.swift`、`SessionRestore.swift` + `SessionStartup.swift` (bookmark 復元)、`AppLifecycle.swift`、`LiveActivity.swift`。

## このリポジトリの TS 規約

- 全体 ESM (`"type": "module"`)。TS の相対 import は `.js` 拡張子必須 (NodeNext resolution): `import { foo } from "./bar.js"`。
- TS は strict、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax` 有効。型のみ import は `import type` を使い、optional property は本当に optional として宣言する (`T | undefined` ではなく `T?`)。
- branded ID: `UserId` / `DeviceId` / `HostId` などは `string & { readonly __brand: ... }`。Relay の `createId` のような helper 経由で発行し、生 string を cast しない。

## 避けるべきこと

- doc 上だけで存在しない package manager / build / lint / test command を書かない。`AGENTS.md` は「実行していない test を実行したことにしない」ことを明示している。
- `pc-host` や `packages/security` を先回りで作らない。MVP の一周が動くまで延期と決まっている。
- E2E privacy / App Store 公開対応 / 完全な thread / session 互換 / 中央 Codex 実行 を追加しない。すべて MVP 非目標として明示されている。
- placeholder device session の上に production-grade auth を勝手に積まない。`docs/security-model.md` の Phase 7 と整合させる。
