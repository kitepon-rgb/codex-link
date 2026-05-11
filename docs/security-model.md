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

MVP の device credential は、device ごとの bearer token です。Host bootstrap と iPhone placeholder device session 作成時に Relay が token を返し、Relay 側は token 本体ではなく SHA-256 hash と expiry だけを保存します。credential は `CODEX_LINK_DEVICE_CREDENTIAL_TTL_MS` の TTL を持ち、期限切れ credential は認証拒否します。credential rotate API は有効な bearer token を要求し、古い token を即時に無効化して新しい token / expiry を返します。iPhone app は device session bearer token を Keychain に保存します。Mac Host installer は bearer token を macOS Keychain に保存し、`host.json` には Keychain reference だけを置きます。`host.json` は `chmod 600` 前提で、runtime も group / others readable な config を拒否します。Relay WebSocket、device session pairing / revocation、HostAccess grant / revoke は `Authorization: Bearer <deviceToken>` を要求します。

MVP の iPhone pairing は placeholder 実装です。Host が認証済み WebSocket 接続から短命かつ一回限りの pairing code を発行し、iPhone の認証済み placeholder device session がその code を redeem した場合だけ、対象 Host への `operator` HostAccess を付与します。すでに `owner` HostAccess を持つ user の role は pairing で降格しません。Host ID を知っているだけでは pairing できません。

MVP の device revocation も placeholder 実装です。Relay は revoke API を device credential で保護し、revoke 済み device の credential を削除し、新規接続、pairing、既存 WebSocket session からの message を拒否し、active session を切断します。ただし外部 IdP、短命 user session、永続 credential storage はまだありません。

この pairing / revocation / device credential は本物の multi-user authentication の代替ではありません。Phase 8 で B-1 + QR + 恒久ペアリングに置き換えます (下記)。

### Phase 8: B-1 + QR + 恒久ペアリング (本物の multi-user 認証)

外部 IdP integration を追加せず、Codex CLI が既に持っている ChatGPT OAuth 認証を本人確認の根拠として再利用します (B-1)。新しい IdP (Google / Apple / GitHub 等) の OAuth client を Codex Link 側で立てません。これは「ユーザーが既に Codex CLI に login 済み = 二重 login 不要」という最小摩擦を狙う設計判断であり、ChatGPT の login 手段が Google / Apple / メアドのどれであっても (ChatGPT account 側で `email` 文字列が確定していれば) 等しく扱えます。

Phase 8 の認証モデル:

- Mac Host bootstrap は `codex app-server` への `account/read` (`AuthMode = chatgpt`) で **ChatGPT account email / accountId / planType** を取得し、Relay の Host 登録に同梱します。`apiKey` モードや未認証状態の場合は ChatGPT account 不在として扱い、Phase 7 placeholder 動作 (匿名 owner user) にフォールバックします。Mac 上の Codex の認証状態が「Mac の本人確認」の信用根拠になります。
- Relay の `Host` model は `chatgptAccountId` と `chatgptEmail` を optional フィールドとして持ち、`HostPairingCode` にもこの紐付けを伝搬させます。grant 時の `HostAccess` audit metadata に「`pair via chatgpt:<accountId>`」として記録し、後から「どの ChatGPT account に紐付いたペアか」を照会できるようにします。
- Mac Host は pairing code 発行と同時に **QR コードを起動端末画面に表示** します。QR の payload は `codexlink://pair?relayUrl=<url>&hostId=<hostId>&code=<short-code>&accountId=<chatgptAccountId>` の deep link 1 本で、iPhone はカメラを向けるだけで Relay URL / Host ID / pairing code / 紐付く ChatGPT account を一括取得します。短い code 入力は debug 経路に降格させ、通常 UI からは外します。
- iPhone は ChatGPT OAuth client にはなりません (公開 third-party flow が無いため)。iPhone は QR を読み取り、`POST /api/device-session/pair` を従来通りの flow で叩くだけです。「私はこの ChatGPT account を持つ Mac の所有者から pairing code を渡された」ことを Relay に主張する形になります。Mac の認証状態を信用する設計です。
- 恒久性は 3 層で担保します:
  1. **HostAccess** (= ペアの本体) は明示 revoke まで永続。Phase 7 から変更なし。
  2. **Device credential** は Keychain に永続保存し、TTL の 70% を経過した時点で iPhone が **無音で `/api/device-credential/rotate`** を叩いて差し替えます。失敗は次回 reconnect で retry、ユーザーには再 pair を求めません。`CODEX_LINK_DEVICE_CREDENTIAL_TTL_MS` の既定は MVP の 30 日から 90 日 (短くて 90 日、長くて 365 日のレンジで運用) に伸ばします。
  3. **WebSocket session** は揮発で、reconnect は `subscribeHost { afterSequence }` で gap 無し復旧。MVP 既に実装済。
- iOS app は Keychain access に entitlement section を必要とします (`-34018 errSecMissingEntitlement` 回避)。最小 `<dict/>` 空の `CodexLinkApp.entitlements` を target に当てて embed します。`keychain-access-groups` の追加は app と widget 間で credential 共有が必要になった時点で別 PR で扱います。
- iPhone 側 device credential を紛失した場合 (アプリ削除 / Keychain 破損 / 他端末への移行) は QR 再スキャンで再 pair します。Mac Host は ChatGPT account 認証が生きている限り何度でも pairing code を再発行できるため、ユーザー側の追加操作はありません。

Phase 8 が境界を変えるのは「pair の発行根拠を ChatGPT account に固定し、UI を QR + 恒久 credential に置き換える」点だけで、Relay の broker-only 性、`~/.codex` 不所持、Codex 不実行といった既存原則には影響しません。Codex Link 自身は ChatGPT のトークンや refresh token を保存せず、`account/read` で取れる email / accountId / planType だけを Host metadata として保持します。

MVP の Host sharing / ACL は、既存 HostAccess の owner role を持つ user だけが `operator` または `viewer` を grant / revoke できる段階です。request body の `ownerUserId` / `ownerDeviceId`、bearer device credential、既存 ACL を照合しますが、production authentication や短命 session credential はまだ未完成です。owner access は sharing API から revoke しません。`viewer` は Host event cache を購読できますが、Host への command routing は `owner` / `operator` だけに許可します。

MVP の rate limit は単一 Relay process 内の in-memory window です。device session creation / pairing / revoke、HostAccess grant / revoke、Host bootstrap、Host pairing code creation、client subscribe / route を対象にします。HTTP JSON body は `CODEX_LINK_MAX_HTTP_BODY_BYTES` で上限を設定し、超過時は `PAYLOAD_TOO_LARGE` として拒否します。WebSocket message payload は `CODEX_LINK_MAX_WEBSOCKET_PAYLOAD_BYTES` で上限を設定し、超過時は接続を閉じます。Relay の数値 env は起動時に検証し、不正値は既定値へフォールバックせず起動エラーにします。複数 process で共有される quota、永続化、user plan 別の制御は hardening phase の対象です。

MVP の audit metadata は単一 Relay process 内の in-memory log です。`CODEX_LINK_AUDIT_EVENT_LIMIT` で保持件数を制限し、既定は 1000 件です。Relay service は action / outcome / user / device / host / limit で filter できますが、production 向けの durable storage、retention job、検索 UI、export policy は未完成です。

## Relay が保存してよいもの

- ユーザーとデバイスのメタデータ
- Host メタデータ
- Host のオンライン状態
- アクセス制御レコード
- 最小限の監査メタデータ。Host routing、HostAccess grant / denial、pairing、device registration / credential issue / authentication denial / revocation の事実だけを記録し、device token、pairing code 本体、Codex payload は記録しない。
- 再接続用の短いイベントキャッシュ

## Relay が保存してはいけないもの

- プロジェクトフォルダ
- ローカル Codex の認証状態
- SSH 認証情報
- ローカルファイルシステムの内容
- Codex セッションの正本
- 明示的に設計していない長い raw log

## Relay のプライバシーモデル

MVP では broker-readable Relay を採用します。つまり Relay process は、iPhone から Host へ送る command payload と、Host から iPhone へ送る Codex Link event payload を中継時に読めます。

その代わり、MVP では保存範囲を明確に制限します。

- Host command payload は Relay の永続状態、event cache、audit metadata に保存しない。認可後に active Host WebSocket へ transient に転送するだけにする。
- Host event payload は再接続用の短い bounded event cache に保存する。これは transcript / timeline / approval / diagnostics の表示復元用 projection であり、Codex セッションの正本ではない。
- audit metadata には user / device / host / action / outcome / 最小 detail だけを残し、device token、pairing code 本体、Host command payload、Codex prompt 本文、approval payload は残さない。

これはエンドツーエンドプライバシーではありません。長期的には、iPhone app と Host app の間の暗号化ルーティングを検討できます。その場合、Relay はルーティングメタデータだけを見る形に近づけます。

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

MVP の詳細表示:

- command approval は command、cwd、reason、network destination、追加 filesystem / network permission、policy amendment を Host で整形して表示する。
- file change approval request 自体に diff が含まれない場合は diff を捏造しない。app-server が `item/fileChange/patchUpdated` または復元済み `fileChange` item として出した diff を timeline detail として表示する。
- network approval は少なくとも protocol / host を表示する。port が app-server payload にない場合は表示しない。
- permissions approval は cwd、reason、requested network permission、requested filesystem read / write / entry scope を表示する。
- detail が長い場合、Host は表示用に切り詰めたことを明示したうえで event payload を bounded に保つ。
- iPhone app と Relay は承認 request を独自 timeout で成功/失敗扱いしない。timeout、cancellation、別経路での解決は app-server の `serverRequest/resolved` を Host が `approval.resolved` に変換し、decision が不明な場合は decision を省略して UI だけを解決済みにする。

MVP TODO:

- [x] command execution approval の基本表示内容を定義する。`docs/ui-design.md` の Approval UI を参照。
- [x] file change approval の基本表示内容を定義する。`docs/ui-design.md` の Approval UI を参照。
- [x] network approval の基本表示内容を定義する。`docs/ui-design.md` の Approval UI を参照。
- [x] `tool/requestUserInput` の基本表示内容を定義する。`docs/ui-design.md` の Approval UI を参照。
- [x] file diff / network destination / requested permissions の詳細表示仕様を詰める。
- [x] 承認 request timeout / cancellation の扱いを定義する。

## 非目標

- 他ユーザーの Host を表示すること
- 全ユーザー共通のトークンを使うこと
- iPhone app を SSH クライアントにすること
- Relay を Codex 実行サーバにすること
- Relay を Codex 文脈の正本にすること
