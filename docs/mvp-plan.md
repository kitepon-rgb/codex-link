# MVP 計画

MVP では、まず以下の流れが一周動くことを証明します。

```text
iPhone app
  -> Relay
      -> Mac Host
          -> local Codex
```

すべてのプラットフォームや Codex 機能を最初から支える必要はありません。

## 現在の優先方針

- Mac Host を最初の Host 実装にする。
- Relay は broker / registry / router に徹し、Codex は実行しない。
- Host は Codex app-server の公式 surface を使う。
- `codex remote-control` は追跡するが、2026-05-10 時点では enrollment HTTP 404 のため MVP 既定入口にしない。
- iPhone app は Codex Link protocol だけを話す。
- iPhone app の理想形は、ほぼ ChatGPT の iPhone app とする。Host / Project 選択は必要導線だが、通常体験の主役にしない。
- transcript と timeline は最初から分ける。
- Live Activity は MVP 内で扱うが、App Store 公開対応は MVP 後に回す。
- remote connections / app-server が alpha / experimental でも、価値が高いものは検証対象にする。

## 矛盾監査 2026-05-10

- UI 方針: 起動直後に常に Host list を主画面にする計画は採用しない。前回の Host / Project / Thread が復元できる場合は conversation screen へ戻し、Host list は初回、切替、アクセス不能時の導線にする。
- 認証方針: Phase 4 の Login は MVP device session / placeholder login とする。本物の multi-user authentication、device revocation、ACL sharing は Phase 7 の対象として残す。
- event 方針: Codex Link event 正規化、transcript projection、timeline projection、approval projection、LiveActivityState はすでに core 実装済みとして扱う。Phase 6 は追加実装ではなく、実 UI への統合と log gap 検証を中心にする。
- Codex 連携方針: remote connections は第一級の検証対象だが、2026-05-10 時点の MVP 入口は Mac Host outbound Relay + local `codex app-server` stdio とする。SSH 設定は remote connections 経路の検証項目であり、MVP の通常接続体験でユーザーへ要求しない。

## Phase 0: 仕様同期と検証準備

- [x] `docs/requirements.md` をマスター仕様として整理する。
- [x] `docs/architecture.md` に protocol 境界と event model を置く。
- [x] `docs/security-model.md` に app-server 公開境界と承認境界を置く。
- [x] `rag/third-party/openai-codex.md` に Codex remote connections / app-server の解釈を置く。
- [x] `codex app-server generate-ts` の出力場所を決める。TS bindings は `packages/codex-client/src/generated/codex-app-server/` に置く。
- [x] 現在インストールされている Codex CLI version を記録する。2026-05-10 時点: `codex-cli 0.130.0`。
- [x] `codex app-server` stdio smoke を作る。`scripts/codex-app-server-smoke.mjs`。
- [x] `codex remote-control` smoke を実行する。2026-05-10 時点では起動時に remote-control enrollment が HTTP 404 で失敗したため、成功扱いにしない。
- [x] loopback WebSocket + auth smoke を作る。`scripts/codex-app-server-ws-smoke.mjs`。
- [x] `thread/start` -> `turn/start` -> event stream -> `turn/completed` の最小ログを保存する。ログは `tmp/codex-app-server-smoke/*.jsonl` に出す。
- [x] approval event smoke を作る。`scripts/codex-app-server-smoke.mjs --approval-smoke`。

2026-05-10 の stdio smoke 結果:

- `initialize` / `initialized` が成功。
- `account/read` が成功。auth mode は `chatgpt`。
- `model/list` が成功。既定モデルは `gpt-5.5`。
- `thread/start` が成功。
- `turn/start` が成功し、`turn/completed` の `status: completed` を確認。
- `item/agentMessage/delta` と `item/completed` から assistant message を復元できることを確認。
- app-server event として `deprecationNotice`、`warning`、`mcpServer/startupStatus/updated` も届くため、Host 側では通常ログとは別に診断 timeline へ投影する必要がある。

2026-05-10 の WebSocket smoke 結果:

- `codex app-server --listen ws://127.0.0.1:<port>` が起動。
- `--ws-auth capability-token --ws-token-file <absolute path>` で token file auth を設定。
- 未認証 WebSocket 接続が拒否されることを確認。
- `Authorization: Bearer <token>` 付き WebSocket 接続で `initialize`、`model/list`、`thread/start` が成功。

2026-05-10 の remote-control 調査結果:

- ローカル CLI は `codex-cli 0.130.0`。
- `codex remote-control --help` は headless app-server with remote control と説明している。
- `codex features list` では `remote_control` は `under development` で、既定では disabled。
- OpenAI 公式 PR #21424 によると、`codex remote-control` は `codex --enable remote_control app-server --listen off` 相当の入口。
- ローカル smoke では ChatGPT remote-control enrollment endpoint が HTTP 404 を返した。
- このため、MVP の既定入口は `codex app-server` stdio とし、remote-control は追跡対象にする。

2026-05-10 の schema 生成確認:

- `codex app-server generate-ts --experimental --out tmp/codex-app-server-schema-probe` が成功。
- 生成物は 570 files。実際の保存先は Phase 1 で `packages/codex-client/src/generated/codex-app-server/` を作ってから生成する。

2026-05-10 の approval smoke 結果:

- `thread/start` で `approvalPolicy: "on-request"` と `sandbox: "read-only"` を指定。
- tmp 作業ディレクトリでファイル作成を依頼し、`item/commandExecution/requestApproval` を受信。
- app-server からの approval request には JSON-RPC `id`、`threadId`、`turnId`、`itemId`、`reason`、`command`、`cwd`、`availableDecisions` が含まれることを確認。
- client から `{ "id": <request id>, "result": { "decision": "accept" } }` を返すと、`serverRequest/resolved` が届き、turn が `completed` になることを確認。
- `approval-smoke.txt` の内容が `Codex Link approval OK` になることを確認。

## Phase 1: リポジトリ構成

- [x] app / service / package フォルダを作る。
- [x] placeholder README を追加する。
- [x] 基本的な contribution notes を追加する。
- [x] protocol sketch を追加する。
- [x] `packages/protocol` に共有型の入口を作る。
- [x] `packages/codex-client` に app-server client / schema 生成物の入口を作る。

目標構成:

```text
apps/
  ios/
  mac-host/

services/
  relay/

packages/
  protocol/
  codex-client/

docs/
```

## Phase 2: Relay skeleton

- [x] ユーザーログインの placeholder。
- [x] iPhone と Host のデバイス登録 placeholder。
- [x] 共有 Relay ドメイン設定。
- [x] Host registry model。
- [x] ユーザーごとの Host 一覧。
- [x] Host online/offline status。
- [x] Host WebSocket connection。
- [x] iPhone client connection または HTTP relay。現時点では WebSocket client placeholder。
- [x] 再接続に強い短い event cache。
- [x] すべての Host route の認可チェック。
- [x] `User` / `Device` / `Host` / `HostAccess` / `Connection` model。
- [x] Host 一覧が現在ユーザーの ACL で必ず filter されることを test する。
- [x] Host route が HostAccess なしでは必ず失敗することを test する。

## Phase 3: Mac Host MVP

- [x] 一発 Host install script。
- [x] Host setup が Relay ドメイン設定を書く。
- [x] Host setup が bootstrap token 付き Host 登録 API で認証済みデバイス登録を完了する。
- [x] Host setup が Codex remote connections / app-server 前提の確認を行う。現時点では `codex --version` preflight。
- [x] Host app が Relay に自分を登録する。現時点では installer が `POST /api/host-bootstrap` で登録する。
- [x] Host app が Relay へ outbound connection を開く。
- [x] Host が名前、project、Codex CLI / app-server capabilities を報告する。
- [x] Host が1つの設定済み project folder を公開する。
- [x] Host はまず `codex app-server` stdio を入口にする。
- [ ] `codex remote-control` の enrollment が成功するようになったら、Host 起動方式を再評価する。
- [x] Host が Codex app-server を起動または接続する。
- [x] Host が `initialize` / `initialized` handshake を実行する。
- [x] Host が `thread/start` / `turn/start` を実行する。
- [x] Host command と client helper で `turn/steer` / `turn/interrupt` request を出せる。
- [x] 実 app-server で active turn に対する `turn/steer` / `turn/interrupt` smoke を取る。`scripts/codex-app-server-smoke.mjs --steer-smoke` と `--interrupt-smoke` が成功。
- [x] Host が Codex app-server events を Codex Link events に正規化する。
- [x] Host が `thread/read` / `thread/list` / `thread/turns/list` を transcript / timeline 復元に使える形にする。
- [x] Host が `model/list` / `experimentalFeature/list` / `config/read` を capabilities 報告に使う。
- [x] Host が final response を Codex Link event として返す。
- [x] Host が running/completed/failed の基本状態を報告する。
- [x] Host が visible session timeline を復元できるだけの event を報告する。
- [x] command execution approval を Codex Link approval event に変換する。
- [x] file change approval を Codex Link approval event に変換する。
- [x] network approval を Codex Link approval event に変換する。
- [x] `tool/requestUserInput` を Codex Link input request に変換する。

## Phase 4: iPhone MVP

- [x] iPhone 側 core を SwiftPM package として作る。
- [x] Relay `host.event` / Codex Link event decoder を作る。
- [x] transcript / timeline / approval / LiveActivityState projection を作る。
- [x] Host へ送る turn / restore command encoder を作る。
- [ ] MVP device session / placeholder login。production auth は Phase 7。
- [ ] 起動時に前回の Host / Project / Thread を復元し、可能なら conversation screen から開始する。
- [x] 初回、切替、アクセス不能時の Host list UI。
- [x] Host 選択 UI。
- [x] Project / Thread drawer UI。
- [x] ChatGPT app に近い conversation screen UI。
- [x] Prompt 送信 UI。idle / completed thread では `CodexLinkUIAction.sendPrompt` を出す。
- [x] running turn への追加送信 UI。ユーザーに steer と意識させず `CodexLinkUIAction.steerPrompt` を出す。
- [x] Stop / interrupt を composer 付近の固定位置に置く。
- [x] running/completed/failed/canceled 表示 UI。
- [x] AI が idle / running / waiting for approval / failed のどれかを表示する UI。
- [x] final response 表示 UI。
- [x] Relay WebSocket client の iPhone 側 skeleton。
- [x] turn / restore 系 `CodexLinkUIAction` を Relay WebSocket の `client.toHost` へ変換する。
- [x] approval decision を Host command と app-server response に接続する。
- [x] 開発中 UI をリアルタイム確認するための SwiftUI preview host。
- [x] thinking / running tools の詳細状態を timeline projection から status strip / timeline に表示する。
- [x] Host picker / running / approval / offline の Preview 状態を用意する。
- [x] reconnect 後に使う Host / Project / Thread / Relay sequence bookmark と復元ロジック。
- [ ] reconnect 後に Relay event cache を購読し、visible session state を実 WebSocket で復元する。
- [x] 基本的な approval UI。
- [x] transcript projection を表示する。
- [x] timeline / activity projection を折りたたみ可能に表示する。
- [x] approval request を thread / turn / item 単位で表示する。
- [x] debug / inspector への導線を通常 UI と分ける。

## Phase 5: Live Activity MVP

- [x] LiveActivityState を定義する。
- [ ] iOS app target 側に ActivityKit attributes を定義する。
- [ ] running turn 用に Live Activity を開始する。
- [ ] status を更新する。
- [ ] approval-required state を表示する。
- [ ] completed/failed/canceled で終了する。
- [ ] active turn へタップで戻れるようにする。

## Phase 6: Event-native UX 統合と検証

- [x] Codex events を Codex Link events に正規化する。
- [x] transcript projection を追加する。
- [x] timeline projection を追加する。
- [ ] 通常の reconnect でユーザーに見える log gap が出ないことを確認する。
- [ ] raw logs/debug data を通常 UI にそのまま出さない。
- [ ] reconnect state を追加する。
- [ ] `thread/compact/start` を UI に出す条件を決める。
- [ ] `thread/rollback` を UI に出す条件を決める。

## Phase 7: Multi-user hardening

- [ ] 本物の authentication。
- [ ] device revocation。
- [ ] Host sharing / ACL。
- [ ] audit metadata。
- [ ] rate limits。
- [ ] relay payloads の privacy model 決定。

## MVP の非目標

- Windows Host。
- App Store 公開。
- 完全なエンドツーエンド暗号化。
- 完全な Codex thread/session 互換。
- 旧 `codex-rc` server code の再利用。
- 中央 Codex 実行。
