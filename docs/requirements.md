# 要件定義

このファイルは、Codex Link が必ず満たすべき要件をまとめたマスター仕様書です。

細かい背景や古い検討メモは `docs/archive/` に退避し、ここでは「作るものの芯」だけを扱います。

## プロジェクトの目的

Codex Link は、旧 `codex-rc` で実現したかった理想を、作り直して叶えるためのプロジェクトです。

やりたいことはシンプルです。

- ローカル端末で動いている開発セッションを、iPhone アプリから操作できること。
- セッションの状態がわかりやすく見えること。
- ログが欠落したり、アプリ再起動で消えたりしないこと。
- AI が動作中か、待機中か、承認待ちか、失敗したかがわかること。
- 長時間の作業は Live Activities で見えること。
- ユーザーが自分のローカル端末を簡単に接続できること。
- 最終的に App Store に載せられる品質と形を目指すこと。

## 基本構成

```text
iPhone app
  -> Codex Link Relay
      -> Codex Link Host on Mac/PC
          -> local Codex
          -> local project files and tools
```

### iPhone app

iPhone app は、ユーザーが Codex セッションを見る・操作するための画面です。

基本体験の理想は、ほぼ ChatGPT の iPhone app です。
ユーザーは管理画面を操作しているのではなく、ChatGPT に話しかけるようにローカル開発セッションへ指示できるべきです。
Host、Project、timeline、approval、Live Activities は Codex Link 固有の追加要素ですが、会話体験を壊さない形で出します。

必須機能:

- ログイン。MVP では device session / placeholder login から始め、本物の multi-user auth は hardening で完成させる。
- 起動時に前回の Host / Project / Thread を復元し、可能なら conversation screen から開始すること。
- 自分がアクセスできる Host 一覧。初回、明示的な切替、前回 Host へアクセスできない場合の導線として出す。
- Host 選択
- プロジェクト / Thread 選択
- プロンプト送信
- transcript 表示
- timeline 表示
- 承認 UI
- 実行状態表示
- Live Activities
- 再接続後の表示復元

### Codex Link Host

Host は、ユーザーの Mac や PC 上で動くローカルアプリです。

Host が担当するもの:

- ローカル Codex 連携
- ローカルプロジェクトへのアクセス
- ローカルツール実行
- 承認処理
- Codex のイベント収集
- transcript / timeline / status の送信
- ローカルで発生する副作用の管理

Host は、可能な限りインストールコマンド一発で設定できるようにします。

一発インストールで行うこと:

- Host のインストール
- Relay ドメイン設定
- 認証またはペアリング
- ユーザー所有の Host として登録
- 起動設定

ただし、簡単にすることと未認証にすることは別です。Host は必ず認証済みのデバイスとして登録します。

### Codex Link Relay

Relay は、複数ユーザーと複数 Host が接続する共有ハブです。

Relay が担当するもの:

- ユーザー認証
- デバイス登録
- Host 登録
- Host のオンライン状態
- Host へのアクセス制御
- iPhone と Host のルーティング
- 再接続用の短いイベントキャッシュ
- 監査メタデータ
- レート制限

Relay がしてはいけないこと:

- Codex を実行する
- ローカルプロジェクトフォルダを読む
- SSH 鍵を持つ
- `~/.codex` を持つ
- Codex セッションの正本になる
- グローバルな Host 一覧を返す

## 接続体験

ユーザーは、LAN の仕組みや hairpin NAT やポート開放を理解しなくても接続できるべきです。

目標:

- iPhone は Relay ドメインへ接続する。
- Host も Relay ドメインへ outbound 接続する。
- Host への inbound port forwarding は要求しない。
- ユーザーに LAN IP やローカルドメインを手入力させない。
- Host セットアップは、一発インストールとペアリングで完了させる。

## 認証と認可

Relay ドメインは共有ハブなので、認証と認可は最初から必須です。

必須ルール:

- 単一の共有 API トークンを使わない。
- iPhone も Host もデバイスとして登録する。
- デバイス認証情報は取り消し可能にする。
- Host は必ず所有ユーザーと紐づける。
- Host 一覧は、現在のユーザーがアクセスできるものだけ返す。
- Host ID を知っているだけでは操作できない。
- すべてのルーティングで HostAccess を確認する。

## セッション表示

このプロダクトの価値は、iPhone からローカル開発セッションを安心して見られることです。

必須表示:

- AI が待機中か
- AI が考えているか
- ツールを実行中か
- 承認待ちか
- 完了したか
- 失敗したか
- Host がオンラインか
- 再接続中か

ログとイベント:

- iPhone UI の再起動でログが消えない。
- 通常の再接続でユーザーに見えるログ欠落を作らない。
- transcript と timeline を分けて扱う。
- raw debug log は通常 UI にそのまま出さない。
- Relay は再接続に必要な短いイベント投影を持ってよい。
- Codex セッションの正本は、可能ならローカル Codex の thread/session/history とする。

## ローカル副作用

実際の開発作業は、選択された Host 上で実行します。

例:

```text
Mac Host
  -> Xcode
  -> Simulator
  -> local project folder
  -> local shell

PC Host
  -> VS Code
  -> browser
  -> Docker
  -> local project folder
```

Relay と iPhone app はローカル副作用を実行しません。

## Codex 連携

Codex Link は、Codex の remote connections と app-server を中核機能として最大限活用します。

旧 `codex-rc` では、この種の公式機能が不足していたため、VS Code に依存する Web アプリ寄りの構成になり、ログや状態管理が複雑になりました。Codex Link では、その問題を繰り返さないでください。

使命:

- Codex remote connections を第一級の前提として扱う。
- Codex app-server の thread / turn / item / approval / event stream を活用する。
- VS Code 依存の独自実装に戻らない。
- 独自 log scraping を正本にしない。
- Codex 側の先端機能が alpha / experimental でも、プロダクト価値に直結するなら積極的に使う。
- OpenAI が仕様を更新したら、それに追随できる設計にする。

確認済みの公式ドキュメント:

- `https://developers.openai.com/codex/remote-connections`
- `https://developers.openai.com/codex/app-server`

参照メモ:

- `rag/third-party/openai-codex.md`
- `rag/third-party/openai-codex-remote-connections.source.md`
- `rag/third-party/openai-codex-app-server.source.md`
- `rag/third-party/openai-codex-changelog.source.md`

2026-05-10 時点の重要な前提:

- remote connections は alpha だが、Codex Link では採用前提で検証する。
- app-server は rich client 向けの公式 integration surface であり、認証、会話履歴、承認、streamed agent events を扱う。
- app-server transport は `stdio` が既定、WebSocket は experimental / unsupported。
- WebSocket は loopback または SSH port forwarding を基本にし、non-loopback では WebSocket auth を必須にする。
- app-server schema は Codex version ごとに生成できるため、手書き固定型ではなく生成物を使う。
- `codex remote-control` は headless / remotely controllable app-server 用の新しい入口として追跡する。ただし 2026-05-10 時点では enrollment HTTP 404 のため、MVP 既定入口にはしない。
- large thread pagination、`thread/read`、`thread/list`、`thread/turns/list` は transcript / timeline 復元に活用する。
- `thread/compact/start`、`thread/rollback`、`thread/inject_items`、`turn/steer`、`turn/interrupt` は初期から protocol の逃げ道として意識する。
- `tool/requestUserInput`、command execution approval、file change approval、network approval は iPhone 承認 UI へ投影する。

remote connections の方針:

- `remote_connections = true` を有効化する前提で検証する。
- SSH 到達可能な Host 上の project / filesystem / shell を Codex が扱える構成を優先する。
- Host には Codex をインストールし、認証済みで、`codex` コマンドが login shell の `PATH` から見えるようにする。
- SSH host alias / SSH config / key 管理は、remote connections 経路を使う場合の Host セットアップ体験に組み込む。
- ただし MVP の通常接続体験は、Mac Host outbound Relay + local `codex app-server` stdio を入口にする。ユーザーに LAN IP、SSH、port forwarding を通常操作として要求しない。
- remote project threads が remote host 上で read / write / command execution することを前提に UI とイベント設計をする。

app-server の方針:

- Host 連携は、可能な限り `codex app-server` の公式プロトコルを使う。
- `initialize` / `initialized` / `thread/start` / `thread/resume` / `turn/start` / event notifications を中心に設計する。
- `thread/started`、`thread/status/changed`、`turn/*`、`item/*`、`serverRequest/resolved` を Codex Link events に正規化する。
- `thread/read`、`thread/list`、`thread/turns/list` を、再接続後の transcript / timeline 復元に使えるか最初に検証する。
- command execution approval、file change approval、network approval を iPhone の承認 UI に投影する。
- `tool/requestUserInput` を、Codex または app/tool がユーザーに質問するための承認・入力 UI として扱う。
- Codex バージョンごとの schema 生成を使い、実装が古い型に固定されないようにする。
- experimental API が必要な場合は `capabilities.experimentalApi = true` を使う。
- `model/list`、`experimentalFeature/list`、`config/read` は Host capabilities の根拠として使う。

安全上の境界:

- app-server の unauthenticated listener を共有ネットワークやインターネットへ公開しない。
- WebSocket を使う場合は loopback または SSH port forwarding を基本にする。
- non-loopback WebSocket を使う場合は、必ず app-server 側の WebSocket auth を設定する。
- Relay は Codex app-server の代わりに Codex を実行しない。

Codex 連携は、名前の似ている機能から推測して作らないでください。

必要な姿勢:

- 公式ドキュメントで確認する。
- またはローカルで再現可能なスモークテストで確認する。
- 未確認の機能は仮説として扱う。ただし、先端機能の検証実装は歓迎する。
- 最初に使う Codex app-server / remote connections 連携方式を記録してから実装する。

未解決の確認事項:

- Host MVP で使う既定 transport は、現時点では `stdio` を第一候補にする。loopback WebSocket は第2候補として検証を続ける。
- `codex remote-control` は enrollment が成功するようになった時点で、Host MVP の入口候補として再評価する。
- `turn/start` / `turn/steer` / `turn/interrupt` / approvals / event streaming に必要な API の最小セットは何か。
- Host から作った thread が Codex CLI 履歴に出るか。
- Host から作った thread が VS Code Codex 履歴に出るか。
- event history をどこまで公式 API から復元できるか。
- `thread/turns/list` の item view をどの粒度にするか。
- `thread/compact/start` と `thread/rollback` を iPhone UI にいつ出すか。
- `account/login/start` の `chatgptDeviceCode` を iPhone 主導ログインに使えるか。

## App Store 目標

App Store 公開は MVP の対象外ですが、長期目標です。

そのため、初期から以下を意識します。

- iPhone app はネイティブ体験を重視する。
- ローカルネットワークや外部接続の説明を明確にする。
- ユーザーに危険な設定を強要しない。
- 認証、プライバシー、ログの扱いを説明できる設計にする。
- 将来の審査や配布に耐える構成を目指す。

## MVP の範囲

まず証明する流れ:

```text
iPhone app
  -> Relay
      -> Mac Host
          -> local Codex
```

MVP で必須:

- Relay skeleton
- ユーザーログインの仮実装
- iPhone / Host のデバイス登録
- Host registry
- Host online/offline
- Host WebSocket
- 認可付きルーティング
- 再接続用イベントキャッシュ
- Mac Host の一発インストール
- Mac Host からローカル Codex を呼ぶ
- iPhone からプロンプト送信
- 実行状態表示
- 最終応答表示
- 基本的な承認 UI
- Live Activity MVP

MVP でやりすぎないもの:

- Windows Host
- App Store 公開
- 完全なエンドツーエンド暗号化
- 完全な Codex thread/session 互換
- 旧 `codex-rc` server code の再利用
- 中央 Codex 実行サーバ化
