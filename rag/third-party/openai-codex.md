# OpenAI Codex 仕様メモ

このファイルは、Codex Link が Codex の公式機能をどう使うかをまとめる作業メモです。

公式ドキュメントそのものをコピーする場所ではありません。Codex Link の設計・実装に必要な判断だけを、日本語で要約して残します。

## 参照元

確認日: 2026-05-10
スナップショット更新確認: 2026-05-10T10:37Z

- Codex Remote connections
  https://developers.openai.com/codex/remote-connections

- Codex App Server
  https://developers.openai.com/codex/app-server

- Codex Authentication
  https://developers.openai.com/codex/auth

- Codex CLI command line options
  https://developers.openai.com/codex/cli/reference

- Codex Config basics / reference
  https://developers.openai.com/codex/config-basic
  https://developers.openai.com/codex/config-reference

- Codex app settings
  https://developers.openai.com/codex/app/settings

- Codex Feature Maturity / Changelog
  https://developers.openai.com/codex/feature-maturity
  https://developers.openai.com/codex/changelog

## 基本方針

Codex Link は、Codex の remote connections と app-server を中核として使います。

旧 `codex-rc` では、この種の公式機能が不足していたため、VS Code に依存する Web アプリ寄りの構成になり、ログや状態管理が複雑になりました。

Codex Link ではその問題を繰り返さず、Codex の公式イベント、承認、thread / turn / item の流れをできるだけそのまま活用します。

alpha / experimental な機能でも、プロダクト価値に直結するなら積極的に使います。OpenAI 側の仕様変更には追随できる設計にします。

## Remote Connections

remote connections は、SSH で到達できる別マシン上の project / filesystem / shell を Codex が扱うための機能です。

Codex Link での解釈:

- Host 端末は、Codex が remote project を扱う実行環境になる。
- Host 上の project folder、shell、credentials、build environment を Codex が使う。
- iPhone app は SSH クライアントにならない。
- Codex Link Host が、ユーザーに代わって接続状態とイベントを扱う。
- Host への inbound port forwarding は要求しない。

実装前提:

- `remote_connections = true` を有効化して検証する。
- Host は SSH 到達可能であることを前提にできる。
- Host には Codex をインストールし、認証しておく。
- `codex` コマンドが Host 側 login shell の `PATH` から見える必要がある。
- SSH host alias / SSH config / IdentityFile の扱いを Host セットアップに組み込む。

注意:

- remote connections は現時点で alpha。
- availability、setup flow、supported environment は変わる可能性がある。
- それでも Codex Link では、この機能を避ける理由にしない。

## App Server

`codex app-server` は、Codex とクライアントが JSON-RPC で双方向通信するための口です。

Codex Link での解釈:

- Host app は app-server protocol を所有する。
- iPhone app は raw app-server JSON-RPC を直接話さない。
- Relay も app-server にはならない。
- Host app が Codex app-server events を Codex Link protocol に正規化する。

重要な概念:

- thread
- turn
- item
- event notification
- approval request
- server request resolution

Codex Link events へ正規化したいもの:

- `thread/started`
- `thread/status/changed`
- `turn/*`
- `item/started`
- `item/completed`
- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/tool/requestUserInput`
- `serverRequest/resolved`
- `account/updated`
- `account/rateLimits/updated`

## 承認 UI

app-server は、ユーザー設定によって command execution や file change の承認を要求します。

Codex Link では、これを iPhone app の承認 UI に投影します。

必要な UI:

- コマンド実行承認
- ファイル変更承認
- ネットワークアクセス承認
- tool / app によるユーザー入力要求
- 承認済み、拒否、キャンセル、セッション中許可の状態表示

承認状態は `threadId` と `turnId` に紐づけて扱います。

## 認証

app-server は Codex の認証状態を扱う JSON-RPC surface を持っています。

Codex Link で使う可能性があるもの:

- `account/read`
- `account/login/start`
- `account/login/completed`
- `account/logout`
- `account/updated`
- `account/rateLimits/read`
- `account/rateLimits/updated`

ログイン方式としては、API key、ChatGPT browser flow、ChatGPT device-code flow、外部管理トークンが存在します。

Codex Link では、iPhone / Host の製品体験に合うログイン方式を別途検証します。特に device-code flow は、iPhone 側でログイン体験を持ちたい場合に重要です。

## Transport

app-server は stdio と WebSocket transport を持ちます。

方針:

- まずは安全で扱いやすい transport をスモークテストで選ぶ。
- WebSocket を使う場合、loopback または SSH port forwarding を基本にする。
- non-loopback WebSocket を使う場合は、必ず app-server 側の WebSocket auth を設定する。
- unauthenticated app-server listener を共有ネットワークやインターネットに公開しない。

## CLI / Remote Mode

Codex CLI には remote app-server WebSocket endpoint へ接続する `--remote` が存在します。

Codex Link での意味:

- Codex CLI 0.130.0 以降では `codex remote-control` という headless / remotely controllable app-server 用の入口も追加されている。ただし、これは `--remote` の別名ではない。
- Codex Link Host の初期検証では、Codex CLI の `--remote` と app-server WebSocket の組み合わせも確認する。
- `--remote-auth-token-env` は bearer token を環境変数から読み、remote 接続時に送るための入口になる。
- token は `wss://`、または localhost / loopback の `ws://` にだけ送られる前提で扱う。
- Codex Link Relay を app-server WebSocket の素通し公開にしない。

## `codex remote-control` 調査メモ

確認日: 2026-05-10

根拠:

- OpenAI 公式 CLI reference / app-server docs
- OpenAI 公式 GitHub PR: https://github.com/openai/codex/pull/21424
- OpenAI 公式 GitHub release: https://github.com/openai/codex/releases/tag/rust-v0.130.0
- ローカル `codex-cli 0.130.0`
- ローカル取得した `openai/codex` source snapshot

確認結果:

- 公式 CLI reference の command overview には、2026-05-10 時点で `codex remote-control` はまだ載っていない。
- ローカル `codex remote-control --help` では `[experimental] Start a headless app-server with remote control enabled` と表示される。
- `codex features list` では `remote_control` は `under development` で、既定では disabled。
- PR #21424 によると、`codex remote-control` は `codex --enable remote_control app-server --listen off` 相当の入口。
- source 上でも `codex remote-control` は local transport を `AppServerTransport::Off` にし、`features.remote_control=true` をその起動だけに付与している。
- つまり `codex remote-control` は Host が直接 JSON-RPC 接続する local listener ではなく、ChatGPT 側 remote-control backend に app-server を登録して使う流れ。
- remote-control は SQLite state DB、ChatGPT auth、`chatgpt_base_url` から導出される remote-control endpoint を必要とする。
- default endpoint は `https://chatgpt.com/backend-api` から、`/wham/remote/control/server/enroll` と WebSocket URL を作る。
- この Mac の `codex remote-control` smoke では enrollment が HTTP 404 で失敗した。source 上、401 / 403 は auth recovery 対象だが、404 は通常エラー扱い。

解釈:

- 現時点の `codex remote-control` は、OpenAI / ChatGPT 側の一級 remote-control surface に向かう先端機能。
- ただし、このアカウント・この環境では 2026-05-10 時点で backend enrollment endpoint が使えない。
- そのため、Codex Link の MVP 既定経路にはまだ置かない。
- ただし、正式化されたら Codex Link の理想に非常に近いので、R&D 対象として追跡し続ける。

MVP への反映:

- 既定経路は `codex app-server` stdio を第一候補にする。
- loopback WebSocket + auth は第2候補として維持する。
- `codex remote-control` は smoke が成功したら Host 起動方式の再評価対象にする。
- `remoteControl/status/changed` は app-server schema 上に存在するため、Host capabilities / diagnostics に取り込めるようにしておく。

## Config / Feature Flags

Codex 設定は `~/.codex/config.toml` を中心に扱われます。

Codex Link で重要な設定:

- `[features].remote_connections`
- app-server transport / WebSocket auth 関連
- sandbox / approval / permissions 関連
- web search / model / profile 関連
- update check / credential store 関連

Host セットアップでは、ユーザーの既存 `~/.codex/config.toml` を壊さず、必要な設定を検出・追記・説明できるようにします。

## Feature Maturity

Codex の機能には maturity label が付く場合があります。

Codex Link の方針:

- Stable / Beta は通常採用候補。
- Experimental は、プロダクト価値が高ければ積極採用する。
- Under development は、通常の実装依存にはしない。
- ただし検証メモや実験ブランチでの調査は許可する。

重要なのは、Experimental を理由に逃げないことです。Codex Link は先端アプリとして、価値のある新機能に追随します。

## Changelog 監視

Codex 周辺は更新が速いので、実装前と大きな設計変更前に changelog を確認します。

2026-05-10 時点で特に重要な変更:

- 2026-05-10T10:37Z に OpenAI Codex の remote connections / app-server / changelog スナップショットを更新確認した。changelog の先頭は 2026-05-08 の Codex CLI 0.130.0。
- `codex remote-control` が追加されている。
- app-server clients が大きな thread を paging できるようになっている。
- live app-server threads が config 変更を restart なしで拾う修正が入っている。
- remote compaction / v2 streams まわりの修正が入っている。

確認したい観点:

- remote connections の成熟度変更
- app-server protocol / schema の変更
- approvals / events / auth endpoints の変更
- CLI `--remote` / `remote-control` / WebSocket auth の変更
- config key / feature flag の変更
- mobile / app / IDE / CLI 間のセッション共有に関係する変更

## ログとイベント

Codex Link は、独自 log scraping を正本にしません。

基本方針:

- app-server の event stream を優先する。
- transcript と timeline は Codex events から投影する。
- raw debug log は通常 UI に直接出さない。
- Relay は再接続用の短いイベント投影を持ってよい。
- 通常の iPhone app 再起動や再接続で、ユーザーに見えるログ欠落を作らない。

## Version / Schema 追随

Codex の app-server schema は変化する前提で扱います。

方針:

- Codex バージョンごとの schema 生成を検討する。
- 古い型を手書き固定しない。
- unknown event / unknown item type を破棄せず、debug 表示または保全できる構造にする。
- experimental API が必要な場合は `capabilities.experimentalApi = true` を使う。
- OpenAI の仕様変更があったら、このファイルと `packages/protocol` を更新する。

## 初期スモークテスト

最初に確認すること:

- [ ] Host 上で `codex` command が使えるか。
- [ ] `remote_connections = true` を有効化できるか。
- [ ] SSH host alias を Codex が認識できるか。
- [ ] remote project thread が Host 上の filesystem / shell で動くか。
- [ ] app-server を stdio で起動し、`initialize` できるか。
- [ ] `thread/start` と `turn/start` が動くか。
- [ ] turn 実行中の events を受け取れるか。
- [ ] command execution approval を iPhone UI 相当へ投影できるか。
- [ ] file change approval を iPhone UI 相当へ投影できるか。
- [ ] turn 完了後に transcript / timeline を復元できるか。
- [ ] app-server reconnect 後に必要な状態を再構築できるか。
- [ ] `codex remote-control` が Host MVP の入口として使えるか。
- [ ] app-server thread pagination を timeline / transcript 復元に使えるか。

## 実装判断

現時点の判断:

- Codex Link Host は、Codex app-server integration を最重要責務として持つ。
- Relay は Codex app-server を直接外部公開するものではない。
- iPhone app は Codex app-server protocol を直接持たず、Codex Link protocol を話す。
- Codex Link protocol は、Codex app-server event をモバイル表示しやすい形に正規化する。
- 旧 `codex-rc` の run/log model は再利用しない。
