# Codex Link

**Connect your iPhone to local Codex.**

Codex Link は、ユーザー自身の Mac や PC 上で動いている Codex を、iPhone から操作するための独立した companion system です。

中央サーバで Codex を実行するプロダクトではありません。Codex は各ユーザーの端末上でローカルに動き、その端末のプロジェクトフォルダ、shell、Xcode、Simulator、browser、VS Code、Docker などを使います。

中央の Relay は broker / registry / relay に徹します。

- ユーザー認証
- デバイス登録
- Host discovery
- Host online/offline state
- iPhone とローカル Host app の認可付き relay

Codex Link は OpenAI 公式または OpenAI 公認の製品ではありません。

## プロダクト構成

```text
iPhone app
  -> Codex Link Relay
      -> user's MacBook Codex Link Host
          -> local Codex CLI / app-server
          -> local projects / Xcode / shell

      -> user's PC Codex Link Host
          -> local Codex CLI / app-server
          -> local projects / VS Code / browser / Docker
```

## ディレクトリ方針

```text
apps/ios
  ネイティブ iPhone app。

apps/mac-host
  macOS Codex Link Host app。

services/relay
  マルチテナント broker / registry / relay。

packages/protocol
  iPhone <-> Relay <-> Host の共有 protocol。

packages/codex-client
  Host 側の Codex app-server / CLI integration。
```

Windows/Linux Host は将来候補です。MVP が一周動くまでは `apps/pc-host` を作りません。

## 開発コマンド

このリポジトリは TypeScript workspace に `pnpm` を使います。

```bash
pnpm install
pnpm typecheck
pnpm test
```

Relay だけ確認する場合:

```bash
pnpm --filter @codex-link/relay typecheck
pnpm --filter @codex-link/relay test
```

## 基本決定

- iPhone app は SSH クライアントにしない。
- iPhone app はプロジェクトフォルダを直接読まない。
- iPhone app は raw Codex app-server JSON-RPC を直接話さない。
- Host app が Codex 連携とローカル副作用を所有する。
- Relay はマルチテナントで、他ユーザーの Host を表示してはいけない。
- Relay は Codex 文脈の正本にならない。
- 永続的なコード状態は GitHub を通す。つまり、branch、commit、PR、issue、docs を使う。

## ドキュメント

読む順番:

1. [docs/README.md](docs/README.md)
2. [docs/requirements.md](docs/requirements.md)
3. [docs/architecture.md](docs/architecture.md)
4. [docs/security-model.md](docs/security-model.md)
5. [docs/mvp-plan.md](docs/mvp-plan.md)

第三者仕様と外部ドキュメントのスナップショットは [rag/](rag/) に置きます。

## 名前

- App name: **Codex Link**
- Subtitle: **Connect your iPhone to local Codex**
- Mac/PC app: **Codex Link Host**
- Server: **Codex Link Relay**
