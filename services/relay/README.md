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

実装が始まったら、起動方法、環境変数、DB migration、テスト方法をここに追記します。

## 現在の実装

Phase 2 では、DB や HTTP server を入れる前に、Relay の中心ルールを TypeScript のインメモリ service として置いています。

- `src/relay.ts`: User / Device / Host / HostAccess / Connection / event cache / Host pairing code の操作。
- `src/websocket.ts`: Host / iPhone placeholder WebSocket gateway、Host bootstrap HTTP API、device session pairing API。
- `src/state.ts`: インメモリ状態。
- `src/config.ts`: Relay ドメインと event cache limit の設定。
- `test/relay.test.ts`: Host 一覧の ACL filter と Host route 認可のテスト。
- `test/websocket.test.ts`: Host WebSocket 接続、client -> Host routing、event cache subscription のテスト。

## 環境変数

- `CODEX_LINK_RELAY_URL`: Relay の公開 URL。未設定時は `http://localhost:3000`。
- `CODEX_LINK_EVENT_CACHE_LIMIT`: Host ごとの短い event cache 件数。未設定時は `200`。
- `CODEX_LINK_HOST_BOOTSTRAP_TOKEN`: Host install が `userId` / `deviceId` / `hostId` を発行するための bootstrap token。

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

## Device Session / Pairing API

iPhone app は `POST /api/device-session` で MVP placeholder device session を作ります。

```json
{
  "displayName": "owner",
  "deviceName": "Owner iPhone"
}
```

Host は Relay WebSocket 接続後に `host.pairingCode.create` を送ると、Relay から `host.pairingCode.created` を受け取ります。

```json
{
  "type": "host.pairingCode.created",
  "hostId": "host_1",
  "code": "ABCD-EF12",
  "expiresAt": "2026-05-10T00:10:00.000Z"
}
```

iPhone app は `POST /api/device-session/pair` で code を redeem します。成功すると、対象 Host への `operator` HostAccess が付与されます。code は短命かつ一回限りです。

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
  "userId": "usr_1",
  "deviceId": "dev_1",
  "hostId": "host_1",
  "hostName": "Owner MacBook",
  "project": {
    "id": "project_1",
    "name": "Codex Link",
    "path": "/Users/kite/Developer/codex-link"
  }
}
```

## コマンド

リポジトリルートで実行します。

```bash
pnpm install
pnpm --filter @codex-link/relay test
pnpm --filter @codex-link/relay typecheck
```

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

Client は `client.subscribeHost` に `afterSequence` を付けると、Relay はその続きの cached Host events を replay してから `host.subscription.ready` を返します。要求された sequence の続きが cache から落ちている場合、Relay は `HOST_EVENT_CACHE_GAP` を返し、欠落した timeline を成功扱いしません。

これは本物の認証ではありません。Phase 2 の目的は、WebSocket 経由でも HostAccess 認可を必ず通すことを固定することです。
