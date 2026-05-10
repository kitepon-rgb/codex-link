# セキュリティモデル

Codex Link Relay は自宅 LAN 上で動かす場合でも、他のユーザーが使えるなら公開されたマルチテナントサービスとして扱います。

LAN を信頼の根拠にしないでください。

設定された Relay ドメインは、複数ユーザー、複数 iPhone、複数 Host が接続する共有ハブです。デバイス登録、Host 一覧取得、メッセージルーティングの前に、すべての接続を認証します。

## 信頼境界

```text
iPhone app
  ユーザーが操作するモバイルクライアント。

Relay
  公開される broker / registry / routing service。

Host app
  ユーザー所有の Mac または PC。
  ローカル Codex 連携とローカルファイルを管理する。

Codex
  Host 上で動くローカルプロセス。
```

## 必須概念

```text
User
  Host を所有する、または Host へのアクセス権を持つアカウント。

Device
  登録済みの iPhone、Mac Host、PC Host。

Host
  Codex 作業に使えるローカル端末。

HostAccess
  User が Host を見たり操作したりするための明示的な権限。

Connection
  Relay に接続中の Host または iPhone。
```

## 認可ルール

グローバルな Host 一覧を返してはいけません。

iPhone app が見られるのは、現在のユーザーが所有している Host、または明示的に共有された Host だけです。

Host へのすべてのルーティングで、現在のユーザーが選択された Host にアクセスできるか確認します。

Host ID を知っていることは、認可ではありません。

## 認証ルール

マルチユーザー利用で、単一の共有 API トークンは使いません。

必須の性質:

- ユーザーログイン
- デバイスごとの登録
- 一発 Host セットアップのためのペアリングまたはログインフロー
- 取り消し可能なデバイス認証情報
- 短命なアプリセッション
- Host 所有権チェック
- ルートごとの認可チェック

Host インストーラは設定を自動化してよいですが、未認証の Host を作ってはいけません。一発インストールの結果は、認証済みで、ユーザー所有で、取り消し可能なデバイス登録である必要があります。

MVP の iPhone pairing は placeholder 実装です。Host が認証済み WebSocket 接続から短命かつ一回限りの pairing code を発行し、iPhone の placeholder device session がその code を redeem した場合だけ、対象 Host への `operator` HostAccess を付与します。Host ID を知っているだけでは pairing できません。

MVP の device revocation も placeholder 実装です。Relay は revoke 済み device の新規接続、pairing、既存 WebSocket session からの message を拒否し、active session を切断します。ただし revoke API 自体はまだ本物の user authentication で保護されていません。

この pairing / revocation は本物の multi-user authentication、device credential、ACL sharing の代替ではありません。それらは hardening phase で完成させます。

MVP の Host sharing / ACL は、既存 HostAccess の owner role を持つ user だけが `operator` または `viewer` を grant / revoke できる段階です。request body の user id と既存 ACL を照合しますが、production authentication や短命 session credential はまだ未完成です。owner access は sharing API から revoke しません。

MVP の rate limit は単一 Relay process 内の in-memory window です。device session creation / pairing / revoke、HostAccess grant / revoke、Host bootstrap、Host pairing code creation、client subscribe / route を対象にします。複数 process で共有される quota、永続化、user plan 別の制御は hardening phase の対象です。

## Relay が保存してよいもの

- ユーザーとデバイスのメタデータ
- Host メタデータ
- Host のオンライン状態
- アクセス制御レコード
- 最小限の監査メタデータ。Host routing、HostAccess grant / denial、pairing、device registration / revocation の事実だけを記録し、pairing code 本体や Codex payload は記録しない。
- 再接続用の短いイベントキャッシュ

## Relay が保存してはいけないもの

- プロジェクトフォルダ
- ローカル Codex の認証状態
- SSH 認証情報
- ローカルファイルシステムの内容
- Codex セッションの正本
- 明示的に設計していない長い raw log

## Relay のプライバシーモデル

MVP では、実装速度のために broker-readable relay を採用してもよいです。

その場合、Relay が中継内容を読める設計であることを明確に説明します。

長期的には、iPhone app と Host app の間の暗号化ルーティングを検討できます。その場合、Relay はルーティングメタデータだけを見る形に近づけます。

実装していない限り、エンドツーエンドプライバシーを主張してはいけません。

## Host の分離

ローカル副作用は、選択された Host 上で発生します。

Relay はローカルコマンドを実行せず、ローカルプロジェクトフォルダにもアクセスしません。

Host app が所有するもの:

- ローカル Codex 連携
- ローカルプロジェクトアクセス
- ローカル承認
- ローカル実行境界
- ローカル機能の報告

## Codex app-server の公開境界

Host は Codex app-server と同じ端末上で通信します。

MVP の安全な既定:

- app-server stdio transport を第一候補にする。
- WebSocket を使う場合は `ws://127.0.0.1:<port>` の loopback に閉じる。
- リモート接続が必要な場合は SSH port forwarding または mesh VPN を使う。
- non-loopback WebSocket を使う場合は app-server の WebSocket auth を必須にする。
- `--ws-token-file` のような secret-on-disk 方式を優先し、raw token を command line に載せない。
- Relay は app-server WebSocket をそのまま public tunnel しない。

禁止:

- unauthenticated app-server listener を LAN / Internet に公開する。
- Relay に Codex auth token、SSH key、`~/.codex`、app-server bearer token を保存する。
- iPhone app に SSH key や Host filesystem access を持たせる。

## 承認境界

Codex の command execution、file change、network、tool user input は、Host が app-server event として受け取り、Codex Link protocol の `ApprovalRequest` に正規化します。

Relay は承認 request / response を中継してよいですが、承認の意味を勝手に変更してはいけません。

必須:

- 承認 request は `threadId`、`turnId`、`itemId` または `requestId` に紐づける。
- iPhone app は command / cwd / file diff / network destination / requested permissions を表示する。
- 承認 decision は accept / acceptForSession / decline / cancel など、app-server が要求する decision に対応づける。
- `serverRequest/resolved` を受けたら、iPhone 側の承認 UI を必ず解決済みにする。

MVP TODO:

- [x] command execution approval の基本表示内容を定義する。`docs/ui-design.md` の Approval UI を参照。
- [x] file change approval の基本表示内容を定義する。`docs/ui-design.md` の Approval UI を参照。
- [x] network approval の基本表示内容を定義する。`docs/ui-design.md` の Approval UI を参照。
- [x] `tool/requestUserInput` の基本表示内容を定義する。`docs/ui-design.md` の Approval UI を参照。
- [ ] file diff / network destination / requested permissions の詳細表示仕様を詰める。
- [ ] 承認 request timeout / cancellation の扱いを定義する。

## 非目標

- 他ユーザーの Host を表示すること
- 全ユーザー共通のトークンを使うこと
- iPhone app を SSH クライアントにすること
- Relay を Codex 実行サーバにすること
- Relay を Codex 文脈の正本にすること
