# Contribution Notes

このリポジトリは、まず MVP の一周動く流れを証明するためのものです。

作業するときは、以下を守ります。

- `docs/requirements.md` をマスター仕様として扱う。
- Relay、Host、iPhone、Codex app-server の境界を混ぜない。
- Relay を Codex 実行サーバにしない。
- iPhone app から raw Codex app-server JSON-RPC を直接話さない。
- Host が Codex app-server 連携とローカル副作用を所有する。
- 新しい設計判断を入れたら、関係する docs / README も更新する。
- 存在しない build / lint / test コマンドを実行したことにしない。

## 作業順

基本の読み順:

1. `docs/requirements.md`
2. `docs/architecture.md`
3. `docs/security-model.md`
4. `docs/mvp-plan.md`

第三者仕様は `rag/third-party/` を参照します。

## 実装方針

- MVP の既定 Codex 入口は `codex app-server` stdio。
- loopback WebSocket + auth は検証対象。
- `codex remote-control` は追跡対象。enrollment が成功するまでは既定入口にしない。
- TypeScript monorepo を採用する場合は `pnpm` を優先する。
- iOS / macOS は Xcode / SwiftPM の標準的な流れを優先する。
