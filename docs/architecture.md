# アーキテクチャ

## 概要

Codex Link は3つの面で構成します。

```text
Codex Link iPhone app
  <-> Codex Link Relay
      <-> Codex Link Host app
          <-> local Codex CLI / app-server
```

Relay は、認証・Host 登録・オンライン状態・ルーティングを担当するマルチテナントの共有ハブです。

Host は、実際に Codex をローカルで動かす場所です。

iPhone app は、ユーザーが操作するモバイル画面です。

Relay ドメインには複数ユーザーと複数 Host が接続するため、iPhone app と Host app のどちらにも認証が必要です。

iPhone app の通常体験は、Host 管理画面ではなく ChatGPT app に近い conversation screen を中心にします。
Host / Project / Thread 選択は初回、切替、復元失敗時の導線として扱い、前回 session を復元できる場合は conversation screen へ戻します。

## 現在の設計判断

- Relay は共有ハブですが、Codex 実行サーバではありません。
- Host がローカル Codex app-server 連携を所有します。
- `codex remote-control` は追跡対象ですが、2026-05-10 時点では MVP 既定入口にしません。
- iPhone app は raw Codex app-server JSON-RPC を直接話しません。
- Codex Link protocol は、Codex app-server event をモバイル表示しやすい形に正規化します。
- Host から Relay への接続は outbound WSS を基本にし、Host への inbound port forwarding は要求しません。
- Codex app-server WebSocket を使う場合でも、Relay は unauthenticated app-server を外部公開しません。
- MVP の Relay は broker-readable です。Host command payload は保存せず transient に転送し、Host event payload は再接続用の短い bounded event cache にだけ保存します。E2E privacy は未実装です。
- MVP は Mac Host を先に作り、Windows Host は後回しにします。

## 全体図

```text
                 ┌──────────────────────────────────────────────┐
                 │ Codex Link Relay                             │
                 │                                              │
                 │ - users / devices / hosts / ACL              │
                 │ - online state                               │
                 │ - routing / relay                            │
                 │ - audit / rate limit                         │
                 └──────────────────────────────────────────────┘
                         ▲                          ▲
                         │ WSS outbound             │ HTTPS / WSS
                         │                          │
┌────────────────────────┴──────────────┐   ┌───────┴──────────────────────┐
│ Codex Link Host: MacBook              │   │ Codex Link iPhone app         │
│                                       │   │                              │
│ - local Codex CLI / app-server         │   │ - host list                  │
│ - local project folders                │   │ - chat / approval            │
│ - Xcode / Simulator / shell            │   │ - timeline                   │
│ - local side effects                   │   │ - Live Activities            │
└───────────────────────────────────────┘   └──────────────────────────────┘

┌───────────────────────────────────────┐
│ Codex Link Host: Main PC              │
│                                       │
│ - local Codex CLI / app-server         │
│ - local project folders                │
│ - VS Code / browser / Docker / shell   │
└───────────────────────────────────────┘
```

## Relay の責務

- ユーザー認証
- デバイス登録
- Host 登録
- Host のオンライン / オフライン状態
- 所有者と ACL による Host 一覧のフィルタリング
- iPhone から Host へのメッセージルーティング
- Host から iPhone へのイベントルーティング
- デバイス取り消し
- レート制限
- 監査ログ
- 再接続用の短いイベントキャッシュ

Relay がしてはいけないこと:

- Codex を実行する
- ローカルプロジェクトフォルダを読む
- SSH 鍵を持つ
- `~/.codex` を持つ
- Codex の文脈やセッションの正本になる

## Host の責務

- 可能な限り一発インストールで設定できるようにする
- デバイス / Host として認証する
- Relay へ outbound WebSocket を開く
- ローカル Codex を起動または接続する
- プロジェクト一覧と機能情報を公開する
- turn をローカルで実行する
- 承認を処理する
- transcript / timeline / status イベントを流す
- ローカル副作用をローカルに閉じる

## iPhone app の責務

- ユーザー / デバイスとして認証する
- 起動時に前回の conversation / thread を復元する
- 初回、切替、アクセス不能時にアクセス可能な Host 一覧を表示する
- Host とプロジェクト / thread を選ぶ
- turn を送る
- 進行状況、transcript、timeline を表示する
- 承認カードを表示する
- Live Activities を更新する

## ルーティングモデル

Host app は inbound port forwarding を必要としません。

Host app が Relay へ outbound WSS 接続を張ります。

ユーザーに LAN IP、ローカルドメイン、hairpin NAT、ポート開放を理解させない設計にします。Host インストーラが Relay ドメイン設定と認証を案内します。

iPhone app は Relay に接続し、認可された Host を選びます。

Relay は、現在のユーザーがその Host にアクセスできる場合だけメッセージをルーティングします。

MVP の初回接続では、Mac Host が Relay WebSocket 上で短命 pairing code を発行し、iPhone app がその code を redeem して対象 Host への HostAccess を受け取ります。Relay は pairing 後も Host 一覧を ACL で filter し、グローバル Host 一覧は返しません。

MVP のルーティング payload は Relay が読める broker-readable envelope です。Host command payload は認可後に active Host WebSocket へ渡すだけで、Relay state や audit metadata には保存しません。Host event payload は reconnect 用の短い event cache に保存しますが、これは表示復元用 projection であり、Codex thread/session の正本ではありません。

## プロトコル境界

iPhone app は raw Codex app-server JSON-RPC を直接話しません。

```text
Codex app-server protocol
  Host app が所有する境界

Codex Link protocol
  iPhone app、Relay、Host app で共有する境界
```

これにより、Codex 側の実験的なプロトコル変更を iPhone app から隔離します。

## Codex app-server 連携

Host app は、Codex app-server client として振る舞います。

優先する検証順:

1. `codex app-server` の stdio transport。
2. loopback WebSocket。
3. SSH port forwarding 越しの loopback WebSocket。
4. `codex remote-control` の headless entrypoint。

WebSocket transport は experimental / unsupported なので、MVP の安定経路は stdio を第一候補にします。ただし、iPhone から長時間セッションを見続ける体験に WebSocket が有利な場合は、loopback + Host 内部接続または SSH port forwarding に閉じて採用を検証します。

`codex remote-control` は ChatGPT 側 remote-control backend への enrollment が前提のため、local Host が直接 JSON-RPC 接続する入口とは別物として扱います。

Host が app-server から受ける主な event:

- `thread/started`
- `thread/status/changed`
- `turn/started`
- `turn/completed`
- `item/started`
- `item/agentMessage/delta`
- `item/completed`
- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/tool/requestUserInput`
- `serverRequest/resolved`
- `account/updated`
- `account/rateLimits/updated`

Host が使う主な request:

- `initialize`
- `thread/start`
- `thread/resume`
- `thread/read`
- `thread/list`
- `thread/turns/list`
- `turn/start`
- `turn/steer`
- `turn/interrupt`
- `model/list`
- `experimentalFeature/list`
- `config/read`
- `account/read`
- `account/login/start`
- `account/rateLimits/read`

`thread/compact/start`、`thread/rollback`、`thread/inject_items`、`config/value/write`、`config/batchWrite` は、MVP では直接 UI に出しすぎず、protocol に拡張余地を残します。

## Codex Link event model

Relay と iPhone app は Codex の raw event ではなく、Host が正規化した Codex Link event を扱います。

初期 event 種別:

- `host.online`
- `host.offline`
- `host.capabilities.updated`
- `project.list.updated`
- `thread.started`
- `turn.status.changed`
- `assistant.delta`
- `assistant.final`
- `transcript.item.recorded`
- `timeline.item.started`
- `timeline.item.completed`
- `approval.requested`
- `approval.resolved`
- `rate_limit.updated`
- `error.reported`

Transcript と timeline は別 projection とします。

- transcript: ユーザー発話、assistant message、final response を読むための表示。
- timeline: command、file change、tool call、approval、status transition を追うための表示。

Relay は再接続用に短い event projection を持ってよいですが、Codex セッションの正本にはなりません。

## データモデル TODO

- [x] `User` 型を定義する。
- [x] `Device` 型を定義する。
- [x] `Host` 型を定義する。
- [x] `HostAccess` 型を定義する。
- [x] `Connection` 型を定義する。
- [x] `ProjectRef` 型を定義する。
- [x] `ThreadRef` 型を定義する。
- [x] `TurnRef` 型を定義する。
- [x] `CodexLinkEvent` union を `packages/protocol` に定義する。
- [x] `ApprovalRequest` / `ApprovalDecision` を `packages/protocol` に定義する。
- [x] Relay 保存用の event cache schema を定義する。

## 目標ディレクトリ構成

```text
apps/
  ios/
  mac-host/

services/
  relay/

packages/
  protocol/
  codex-client/
```

`pc-host` と `packages/security` は将来候補です。MVP が一周動くまでは作らず、必要になった時点で追加します。
