# Codex Link Mac Host

ユーザーの Mac 上で動き、ローカル Codex と Relay をつなぐ Host アプリです。

MVP で扱うもの:

- 一発インストール
- Relay への Host 登録
- Relay への outbound 接続
- iPhone pairing code の発行
- ローカル project の公開
- `codex app-server` stdio 起動
- Codex app-server event の Codex Link event への正規化
- 承認要求の中継
- transcript / timeline / status の送信

Codex の実行、副作用、ローカルファイルアクセスはこの Host 側に閉じます。

`codex remote-control` は追跡対象ですが、2026-05-10 時点では enrollment が HTTP 404 のため、MVP の既定入口にはしません。

## 現在の実装

Phase 3 の最初として、Host の最小 package を置いています。

- `src/config.ts`: `~/.codex-link/host.json` の読み込み。
- `src/capabilities.ts`: `codex --version`、project path preflight、app-server `model/list` / `experimentalFeature/list` / `config/read` の capabilities 収集。
- `src/codex.ts`: `codex app-server` stdio 起動と `initialize` / `initialized` handshake。
- `src/codex-events.ts`: app-server notification / server request / thread read response を Codex Link event へ正規化。
- `src/session.ts`: Relay からの turn 操作、thread 復元、approval decision command を app-server request / response へ変換。
- `src/relay-client.ts`: Relay への outbound WebSocket 接続、Host 向け message 受信、短命 pairing code 発行 request。
- `scripts/install.sh`: 一発セットアップ用の設定ファイル生成 script。

## セットアップ placeholder

Relay に `CODEX_LINK_HOST_BOOTSTRAP_TOKEN` が設定されている場合は、installer が Host bootstrap API へ接続し、`userId`、`deviceId`、`hostId` を受け取って Host config を作ります。

```bash
CODEX_LINK_RELAY_URL=https://relay.example.com \
CODEX_LINK_HOST_BOOTSTRAP_TOKEN=<token> \
CODEX_LINK_PROJECT_PATH="$PWD" \
apps/mac-host/scripts/install.sh
```

Relay から発行済みの `userId`、`deviceId`、`hostId` を直接使う場合は、以下でも作れます。

```bash
CODEX_LINK_RELAY_URL=ws://127.0.0.1:3000 \
CODEX_LINK_USER_ID=usr_1 \
CODEX_LINK_DEVICE_ID=dev_1 \
CODEX_LINK_HOST_ID=host_1 \
CODEX_LINK_PROJECT_PATH="$PWD" \
apps/mac-host/scripts/install.sh
```

起動:

```bash
pnpm --filter @codex-link/mac-host exec codex-link-mac-host ~/.codex-link/host.json
```

起動時に `Codex Link iPhone pairing code: ABCD-EF12 (...)` の形で短命 code を表示します。iPhone app の Host picker でこの code を入力すると、MVP placeholder device session にその Host への `operator` HostAccess が付与されます。
