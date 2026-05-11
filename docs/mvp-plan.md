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
- 認証方針: Phase 4 の Login は MVP device session / placeholder login とする。本物の multi-user authentication は Phase 7 の対象として残し、device revocation、ACL sharing、device credential は MVP placeholder から段階的に hardening する。
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
- 2026-05-11 JST の再 smoke でも同 endpoint は HTTP 404 のままだった。
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

2026-05-11 の cross-source thread 可視性検証:

- `node scripts/mvp-local-smoke.mjs --turn --wait-complete` で iPhone → Relay → Mac Host → `codex app-server` 経由の turn を完了まで実行すると、`~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl` に rollout file が新規作成されることを確認 (sessions 件数 24 → 25 → 26)。Codex CLI の rollout ストアが Codex Link 経由でも正本のまま使われる。
- 作成された rollout の `session_meta.payload.source` を実測したところ、**`"vscode"`** が記録されていた (`originator: codex_link_mac_host`, `cli_version: 0.130.0`)。`scripts/codex-app-server-thread-source-probe.mjs` で `thread/list` を 3 通り (default / 明示 `["cli","vscode","exec","appServer"]` / `["appServer"]` のみ) 呼び分けたところ、いずれも cwd 配下では `vscode` 12 件、`appServer` 0 件。`env -i` で `VSCODE_*` / `TERM_PROGRAM` を strip した状態でも source は `vscode` のままだった。Codex CLI 0.130.0 は app-server 経由でも source を `appServer` ではなく `vscode` として記録する挙動になっている。
- 結果として、iPhone 駆動 (Mac Host 経由) の thread は VSCode Codex 拡張側の default thread 一覧と同じ source bucket に入る。逆方向 (VSCode で開始した thread を iPhone で開く) は、Mac Host の `listThreads` (`apps/mac-host/src/session.ts`) で `sourceKinds: ["cli", "vscode", "exec", "appServer"]` を明示するように更新済み。
- 上流挙動の固定化への耐性として、`sourceKinds` を明示しておけば、将来 Codex CLI が source 推定を変えて `appServer` を返すようになっても iPhone 側 thread picker に欠落しない。
- 残作業: 実 VSCode + Codex 拡張で iPhone 駆動 thread が thread picker に出ること、および逆方向の resume 動作を目視確認する (UI 観察なのでコード側 smoke では完結しない)。

## Phase 1: リポジトリ構成

- [x] app / service / package フォルダを作る。
- [x] placeholder README を追加する。
- [x] 基本的な contribution notes を追加する。
- [x] protocol sketch を追加する。
- [x] `packages/protocol` に共有型の入口を作る。
- [x] `packages/codex-client` に app-server client / schema 生成物の入口を作る。
- [x] Relay の Docker container deploy 入口を作る。共有サーバーへ直置きしない。

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
- [x] MVP device session / placeholder login。production auth は Phase 7。
  - Relay は `/api/device-session` で placeholder iPhone device session を発行する。
  - iPhone core は `CodexLinkDeviceSessionClient` で device session を登録できる。
- [x] 起動時に前回の Host / Project / Thread を復元し、可能なら conversation screen から開始する。
  - `CodexLinkStartupRestorer` が保存済み bookmark を読み、Relay cache 復元後の selection を返す。
  - 実 app lifecycle への接続は後続の app target binding で扱う。
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
- [x] reconnect 後に Relay event cache を購読し、visible session state を実 WebSocket で復元する。
  - Relay は `host.subscription.ready` で cache replay の完了点を明示する。
  - iPhone client は bookmark の `lastRelaySequence` 以降を購読し、projection / selection / bookmark を更新する。
- [x] 基本的な approval UI。
- [x] transcript projection を表示する。
- [x] timeline / activity projection を折りたたみ可能に表示する。
- [x] approval request を thread / turn / item 単位で表示する。
- [x] debug / inspector への導線を通常 UI と分ける。
- [x] 実 iOS app target で placeholder login、startup restore、Relay WebSocket action binding を app lifecycle に接続する。
  - `CodexLinkAppViewModel` が placeholder device session 登録、保存 bookmark からの startup restore、Relay receive loop、UI action send を接続する。
  - `CodexLinkApp` target は `CodexLinkRootView`、Relay lifecycle、Live Activity sync、deep link を接続する。
- [x] 新規 iPhone device session に既存 HostAccess を付与する MVP pairing flow を作る。
  - Host WebSocket は `host.pairingCode.create` で短命かつ一回限りの pairing code を発行できる。
  - iPhone app は Host picker から pairing code を redeem し、Relay の `/api/device-session/pair` で対象 Host への `operator` HostAccess を受け取る。
  - 既存 `owner` HostAccess は pairing で `operator` に降格しない。
  - redeem 後は `client.subscribeHost` で対象 Host の event cache を購読し、Host / Project / Thread 表示に入る。
  - これは MVP placeholder pairing であり、production authentication、短命 user session、production ACL sharing は Phase 7。

## Phase 5: Live Activity MVP

- [x] LiveActivityState を定義する。
- [x] iOS app / widget target から使う ActivityKit attributes を定義する。
  - `CodexLinkTurnActivityAttributes` は SwiftPM module 内で iOS 条件付きにして、app target / widget extension から import する。
- [x] running turn 用に Live Activity を開始する。
  - `CodexLinkLiveActivityController.sync(...)` が visible selection / projection から running turn を開始する。
- [x] status を更新する。
  - 同じ active turn の snapshot は existing activity に update する。
- [x] approval-required state を表示する。
  - Activity content state と WidgetKit 表示で `approvalRequired` を強調する。
- [x] completed/failed/canceled で終了する。
  - terminal turn status は final content 付きで Activity を end する。
- [x] active turn へタップで戻れるようにする。
  - `codexlink://thread?...` deep link を生成し、Live Activity widget に `widgetURL` として渡す。
- [x] 実 iOS app target / widget extension を追加し、`sync(...)` と `onOpenURL` を実アプリ lifecycle に接続する。
  - `CodexLink.xcodeproj` に `CodexLinkApp` と `CodexLinkWidgets` を追加。

## Phase 6: Event-native UX 統合と検証

- [x] Codex events を Codex Link events に正規化する。
- [x] transcript projection を追加する。
- [x] timeline projection を追加する。
- [x] 通常の reconnect でユーザーに見える log gap が出ないことを確認する。
  - Relay は `client.subscribeHost.afterSequence` から続く cached event を replay し、`host.subscription.ready.latestSequence` を返す。
  - `afterSequence` の次 event が cache から落ちている場合は、成功扱いせず `HOST_EVENT_CACHE_GAP` を返す。iPhone app はこれを接続失敗として通常 UI に出す。
- [x] raw logs/debug data を通常 UI にそのまま出さない。
  - Codex `warning` / `deprecationNotice` / `mcpServer/startupStatus/updated` は `diagnostic.reported` に分離する。
  - iPhone projection は diagnostics を transcript / timeline と別に保持する。
- [x] reconnect state を追加する。
  - `CodexLinkConnectionState` を UI state として定義し、status strip に接続状態を出す。
  - Preview に reconnecting state を追加する。
- [x] `thread/compact/start` を UI に出す条件を決める。
  - MVP の通常 composer には manual compact ボタンを出さない。
  - app-server が `context_compaction` / `compaction` item を通知した場合だけ、Host が `Context compaction` timeline item として投影する。
  - manual compact 実行 UI は、Host 側 command と local smoke が追加された後、debug / inspector 側で selected thread があり active turn が running / waiting approval ではない場合に限定する。
- [x] `thread/rollback` を UI に出す条件を決める。
  - MVP の通常 UI には rollback 操作を出さない。
  - 実装する場合は、`thread/rollback` の local smoke、Host command、rollback 後の `thread/read` / `thread/turns/list` 再投影が揃った後に限る。
  - 入口は debug / inspector 側に限定し、selected thread、rollback 対象 turn 数、実行後に失われる表示範囲を明示してから実行する。
  - 未検証の rollback / inject 挙動を、既存の conversation 操作として扱わない。

## Phase 7: Multi-user hardening

- [ ] 本物の authentication。
  - [x] MVP placeholder として、device ごとの bearer credential を発行し、Relay 側は hash / expiry だけを保存する。
  - [x] Relay WebSocket、device session pairing / revocation、HostAccess grant / revoke を device credential で保護する。
  - [x] device credential の TTL、期限切れ拒否、rotation API を追加する。
  - [x] iPhone app の device session bearer token を Keychain に保存する。
  - [x] Mac Host config の bearer credential file mode を runtime で検査し、group / others readable な config を拒否する。
  - [x] Mac Host installer は bearer credential を macOS Keychain に保存し、`host.json` には Keychain reference だけを置く。
  - [ ] 外部 IdP / login、短命 user session、永続 storage と結びついた production credential lifecycle。
- [ ] device revocation。
  - [x] MVP placeholder device session の revoke API を作り、revoked device の新規接続、pairing、既存 WebSocket message を Relay で拒否する。
  - [x] MVP device credential と結びついた revocation API にする。
  - [ ] production authentication と結びついた revocation。
- [ ] Host sharing / ACL。
  - [x] MVP placeholder として、Host owner role だけが `operator` / `viewer` HostAccess を grant / revoke できる owner-checked API を作る。
  - [x] owner device credential と結びついた sharing API にする。
  - [x] `viewer` は Host event 購読のみ許可し、Host command routing は `owner` / `operator` に限定する。
  - [x] HostAccess revoke 時に対象 user の active Host subscription を解除する。
  - [ ] production authentication と結びついた sharing UI / API。
- [ ] audit metadata。
  - [x] Relay 内で Host routing、HostAccess grant / denial、pairing、device registration / revocation の最小 audit metadata を記録する。
  - [x] device credential issue / authentication denial の最小 audit metadata を記録する。
  - [x] MVP in-memory audit metadata に保持件数上限と filter API を追加する。
  - [ ] production storage / retention / search policy。
- [ ] rate limits。
  - [x] MVP placeholder として、単一 Relay process 内の in-memory window rate limit を sensitive HTTP / WebSocket route に適用する。
  - [x] HTTP JSON body size limit を設定可能にし、超過を `PAYLOAD_TOO_LARGE` として拒否する。
  - [x] WebSocket message payload size limit を設定可能にする。
  - [ ] production storage / distributed quota / user plan 別 limit。
- [x] relay payloads の privacy model 決定。
  - MVP は broker-readable Relay とする。Host command payload は transient routing のみで保存せず、Host event payload は bounded event cache に保存する。
  - audit metadata には token、pairing code 本体、Host command payload、Codex prompt 本文、approval payload を残さない。
  - E2E privacy は未実装として明示する。

## Phase 8: B-1 + QR 恒久ペアリング (Phase 7 placeholder からの昇格)

Phase 7 の MVP placeholder (pairing code 手入力 + per-device credential のみ) を、ユーザーが「Mac で起動 → iPhone でカメラを向ける → 完了」だけで恒久接続できる本物のペアリングに置き換える。Codex CLI が既に持っている ChatGPT OAuth 認証を信用根拠として使い、新しい IdP integration は足さない (B-1 + QR)。

設計の前提:

- pair の本体は **HostAccess (Relay 永続)** で、これは MVP 既に「明示 revoke まで残る」設計になっている。Phase 8 で変えるのは「pair の発行を `ChatGPT account` に紐付け、UI を QR スキャンに変える」部分。
- iPhone は ChatGPT OAuth client にならない (公式 third-party flow が無いため)。Mac Host が `account/read` で確定した ChatGPT account を「Mac の本人確認の根拠」として Relay に登録する。iPhone はその根拠を信用する形でペア。
- credential は Keychain に永続、TTL が来る前に iPhone が無音で rotate する。ユーザーには再 pair を求めない。

進行状況 (この checkbox を更新することで TODO を兼ねる):

- [x] iOS: `CodexLinkApp.entitlements` を追加し `CODE_SIGN_ENTITLEMENTS` を当てて、Simulator / 実機での Keychain access (`-34018 errSecMissingEntitlement`) を解消する。entitlements は最小 (空 dict + 必要なら `keychain-access-groups`) から。
- [x] Mac Host: `account/read` で ChatGPT account の email / planType を取得し、Relay の Host registration / pairing code 発行時にそれを添付する。`apiKey` モードの場合は ChatGPT account 不在として扱う (=従来 placeholder 動作にフォールバック)。
- [x] Protocol / Relay: `Host` model に `chatgptAccount` (optional) を持たせ、`HostPairingCode` にも紐付ける。`/api/device-session/pair` redeem 時に Relay が「この Host の ChatGPT account 紐付き」を audit metadata でも参照可能にする。
- [x] Mac Host: pairing code を発行したら、CLI 出力に加えて **QR コード (ターミナル ANSI)** を端末画面に出す。QR の payload は `codexlink://pair?relayUrl=...&hostId=...&code=...&email=...` の deep link 1 本にして iPhone 1 スキャンで完結させる。
- [x] iPhone: AVFoundation ベースの QR スキャナ (`CodexLinkPairingScannerView`) を `Pair Host` UI に追加し、読み取り結果から `client.pair(...)` を呼ぶ。手入力経路は disclosure 内に降格、通常 UI からは外す。
- [x] iPhone: `CodexLinkAppViewModel.maybeRotateDeviceCredential` で「期限まで 7 日未満なら無音で `/api/device-credential/rotate` を呼んで Keychain を更新する」auto rotate を入れる。失敗時は次回 launch で retry、明示 error UI には出さない (true permanent 体験のため)。
- [x] Relay: `CODEX_LINK_DEVICE_CREDENTIAL_TTL_MS` の既定値を MVP の 30 日から 90 日に伸ばす。短い既定が「恒久」体験を壊していたため。明示 revoke はそのまま即時失効が利く。
- [ ] iPhone / Mac Host: ペアの「永続性」を裏付ける end-to-end smoke を追加する。`mvp-local-smoke.mjs` に「pair → credential 保存 → app 再起動相当 (新規 WS 再接続) → credential rotate → pair 維持」のシナリオを足す。
- [x] docs: `security-model.md` の "認証ルール" を Phase 8 完了形 (B-1 + QR + 恒久) で書き直し、placeholder と production の境界を MVP placeholder section だけに残す。

非目標 (Phase 8 でもやらない):

- Codex Link 独自の OAuth client 登録 (ChatGPT 第三者 OAuth は公開されていない、apple/google などの別 IdP も足さない)。
- 複数 ChatGPT account の同時管理 (1 Mac Host = 1 ChatGPT account 前提)。
- iPhone から ChatGPT login flow を直接走らせる (Mac Host の認証を信用する設計のため不要)。
- App Store 公開対応 (Phase 9 以降)。

## MVP の非目標

- Windows Host。
- App Store 公開。
- 完全なエンドツーエンド暗号化。
- 完全な Codex thread/session 互換。
- 旧 `codex-rc` server code の再利用。
- 中央 Codex 実行。
