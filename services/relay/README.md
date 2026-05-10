# Codex Link Relay

複数ユーザーと複数 Host が接続する共有ハブです。

Relay が担当するもの:

- ユーザー認証
- デバイス登録
- Host 登録
- Host online / offline
- HostAccess による認可
- 短命 Host pairing code による MVP HostAccess 付与
- iPhone と Host のルーティング
- 再接続用の短いイベントキャッシュ
- 最小限の監査メタデータ

Relay がしないもの:

- Codex の実行
- ローカル project folder の読み取り
- SSH 認証情報の保持
- `~/.codex` の保持
- Codex セッション正本の保持

共有サーバーへのデプロイは Docker コンテナで行います。サーバーに Node.js アプリを直置きして起動する運用はしません。

## 現在の実装

Phase 2 では、DB や HTTP server を入れる前に、Relay の中心ルールを TypeScript のインメモリ service として置いています。

- `src/relay.ts`: User / Device / Host / HostAccess / Connection / device credential / event cache / Host pairing code / audit metadata の操作。
- `src/websocket.ts`: Host / iPhone placeholder WebSocket gateway、Host bootstrap HTTP API、device session pairing / revocation / HostAccess sharing API。
- `src/state.ts`: インメモリ状態。
- `src/config.ts`: Relay ドメインと event cache limit の設定。
- `test/relay.test.ts`: Host 一覧の ACL filter と Host route 認可のテスト。
- `test/websocket.test.ts`: Host WebSocket 接続、client -> Host routing、event cache subscription のテスト。

## 環境変数

- `CODEX_LINK_RELAY_URL`: Relay の公開 URL。未設定時は `http://localhost:3000`。
- `CODEX_LINK_EVENT_CACHE_LIMIT`: Host ごとの短い event cache 件数。未設定時は `200`。
- `CODEX_LINK_HOST_BOOTSTRAP_TOKEN`: Host install が `userId` / `deviceId` / `hostId` を発行するための bootstrap token。
- `CODEX_LINK_RATE_LIMIT_WINDOW_MS`: in-memory rate limit window。未設定時は `60000`。
- `CODEX_LINK_RATE_LIMIT_MAX_REQUESTS`: window ごとの request 上限。未設定時は `120`。
- `CODEX_LINK_AUDIT_EVENT_LIMIT`: in-memory audit metadata の保持件数。未設定時は `1000`。
- `CODEX_LINK_MAX_HTTP_BODY_BYTES`: HTTP JSON body の最大 byte 数。未設定時は `65536`。
- `CODEX_LINK_MAX_WEBSOCKET_PAYLOAD_BYTES`: WebSocket message payload の最大 byte 数。未設定時は `1048576`。

数値 env は起動時に整数として検証します。`CODEX_LINK_EVENT_CACHE_LIMIT` と `CODEX_LINK_AUDIT_EVENT_LIMIT` は `0` を許可し、それぞれ cache / audit retention を無効化します。それ以外の数値上限は `1` 以上が必要です。不正値は既定値へフォールバックせず、起動エラーにします。

## Host Bootstrap API

Host installer は `POST /api/host-bootstrap` に `Authorization: Bearer <CODEX_LINK_HOST_BOOTSTRAP_TOKEN>` を付けて接続します。

request:

```json
{
  "ownerDisplayName": "owner",
  "hostName": "Owner MacBook",
  "project": {
    "id": "project_1",
    "name": "Codex Link",
    "path": "/Users/kite/Developer/codex-link"
  }
}
```

response には `userId`、`deviceId`、`deviceToken`、`hostId` が含まれます。Relay は `deviceToken` 本体を保存せず、SHA-256 hash だけを保存します。Host は以後の Relay WebSocket 接続で `Authorization: Bearer <deviceToken>` を送ります。

## Device Session / Pairing API

iPhone app は `POST /api/device-session` で MVP placeholder device session を作ります。

```json
{
  "displayName": "owner",
  "deviceName": "Owner iPhone"
}
```

response には `userId`、`deviceId`、`deviceToken` が含まれます。iPhone app はこの `deviceToken` を保存し、Relay WebSocket、pairing、revocation API で `Authorization: Bearer <deviceToken>` を送ります。

Host は Relay WebSocket 接続後に `host.pairingCode.create` を送ると、Relay から `host.pairingCode.created` を受け取ります。

```json
{
  "type": "host.pairingCode.created",
  "hostId": "host_1",
  "code": "ABCD-EF12",
  "expiresAt": "2026-05-10T00:10:00.000Z"
}
```

iPhone app は `POST /api/device-session/pair` に `Authorization: Bearer <deviceToken>` を付けて code を redeem します。成功すると、対象 Host への `operator` HostAccess が付与されます。code は短命かつ一回限りです。
すでに `owner` HostAccess を持つ user が redeem した場合、Relay は owner role を `operator` へ降格しません。

```json
{
  "userId": "usr_2",
  "deviceId": "dev_2",
  "pairingCode": "ABCD-EF12"
}
```

response:

```json
{
  "relayUrl": "https://relay.example.com",
  "userId": "usr_2",
  "deviceId": "dev_2",
  "hostId": "host_1",
  "hostName": "Owner MacBook",
  "role": "operator"
}
```

MVP placeholder device session は `POST /api/device-session/revoke` に `Authorization: Bearer <deviceToken>` を付けて revoke できます。Relay は revoked device の新規 WebSocket 接続、pairing、既存 WebSocket session からの message を拒否します。active WebSocket session がある場合は `relay.error` を送って切断します。

```json
{
  "userId": "usr_2",
  "deviceId": "dev_2"
}
```

response:

```json
{
  "relayUrl": "https://relay.example.com",
  "userId": "usr_2",
  "deviceId": "dev_2",
  "revokedAt": "2026-05-10T00:00:00.000Z"
}
```

## Audit Metadata

Relay は Host routing、HostAccess grant / denial、pairing code 発行 / redeem、device registration / credential issue / authentication denial / revocation の最小 audit metadata を記録します。

Audit metadata には pairing code 本体、client.toHost payload、Codex transcript、project folder 内容は保存しません。
MVP の audit metadata は in-memory で、`CODEX_LINK_AUDIT_EVENT_LIMIT` を超えた古い event は破棄します。

## HostAccess Sharing API

MVP placeholder では、Host owner として登録された user だけが HostAccess を grant / revoke できます。request body の `ownerUserId` / `ownerDeviceId` と bearer `deviceToken` を Relay が照合し、さらに既存 HostAccess の owner role を確認します。これはまだ production user authentication ではありません。

grant:

```json
{
  "ownerUserId": "usr_1",
  "ownerDeviceId": "dev_1",
  "hostId": "host_1",
  "targetUserId": "usr_2",
  "role": "operator"
}
```

`role` は `operator` または `viewer` だけです。`owner` は sharing API から付与しません。`operator` は Host へ command を route できます。`viewer` は Host event cache の購読だけができ、`client.toHost` は拒否されます。

revoke:

```json
{
  "ownerUserId": "usr_1",
  "ownerDeviceId": "dev_1",
  "hostId": "host_1",
  "targetUserId": "usr_2"
}
```

owner access は sharing API から revoke できません。

## Rate Limits

MVP Relay は in-memory rate limit を持ちます。対象は device session creation / pairing / revoke、HostAccess grant / revoke、Host bootstrap、Host pairing code creation、client subscribe / route です。
HTTP JSON body は `CODEX_LINK_MAX_HTTP_BODY_BYTES` を超えると `PAYLOAD_TOO_LARGE` で拒否します。
WebSocket message payload は `CODEX_LINK_MAX_WEBSOCKET_PAYLOAD_BYTES` を超えると接続を閉じます。

これは単一 Relay process 内の保護です。複数 process / 永続 storage / user plan 別 quota は production hardening で扱います。

## コマンド

リポジトリルートで実行します。

```bash
pnpm install
pnpm --filter @codex-link/relay build
pnpm --filter @codex-link/relay test
pnpm --filter @codex-link/relay typecheck
```

ローカルで Relay HTTP/WebSocket server を起動する場合も、MVP の通常導線は Docker コンテナです。repo root の compose は `127.0.0.1:3000` にだけ公開し、Host bootstrap token は既定で `codex-link-local-dev-bootstrap-token` を使います。

```bash
docker-compose up --build relay
```

Docker image:

```bash
docker build -f services/relay/Dockerfile -t codex-link-relay .
docker run --rm -p 3000:3000 \
  -e CODEX_LINK_RELAY_URL=https://relay.example.com \
  -e CODEX_LINK_HOST_BOOTSTRAP_TOKEN=<bootstrap-token> \
  codex-link-relay
```

Container health checks use `GET /healthz`.

## WebSocket placeholder

MVP skeleton の WebSocket は `/relay` に接続します。

Host:

```text
ws://localhost:3000/relay?kind=host&deviceId=<deviceId>&hostId=<hostId>
```

iPhone client:

```text
ws://localhost:3000/relay?kind=client&deviceId=<deviceId>&userId=<userId>
```

どちらも WebSocket handshake に `Authorization: Bearer <deviceToken>` が必要です。

Client は `client.subscribeHost` に `afterSequence` を付けると、Relay はその続きの cached Host events を replay してから `host.subscription.ready` を返します。要求された sequence の続きが cache から落ちている場合、Relay は `HOST_EVENT_CACHE_GAP` を返し、欠落した timeline を成功扱いしません。

これは production authentication ではありません。現時点の credential は device ごとの bearer token で、外部 IdP、短命 user session、永続 storage はまだありません。
