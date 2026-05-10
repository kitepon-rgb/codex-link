# Codex Remote Control 周辺調査

確認日: 2026-05-10

このメモは、Codex Link の方向性を決めるために、公式機能と周辺プロダクトの状況を整理したものです。

## 公式機能の整理

似た名前の機能が複数あるため、混同しないこと。

- `remote_connections`: Codex app が SSH 先の project / filesystem / shell を扱う alpha 機能。
- `codex --remote`: TUI から別プロセスの app-server WebSocket に接続する CLI 機能。
- `codex app-server --listen ws://...`: app-server を WebSocket で公開する experimental / unsupported transport。
- `codex remote-control`: local transport を持たない headless app-server を起動し、ChatGPT 側 remote-control backend に登録する新しい experimental 入口。

2026-05-10 時点の判断:

- 今すぐ Codex Link MVP の既定入口にできるのは `codex app-server` stdio。
- loopback WebSocket + auth は有力な検証経路。
- `codex remote-control` は理想に近いが、この環境では enrollment HTTP 404 のため、まだ既定入口にしない。

## 公式 GitHub 上の需要

OpenAI Codex issue #11166 では、app-server の JSON-RPC protocol をネットワーク越しに使い、remote/mobile clients が running session に attach できるようにする要望が整理されている。

重要な観点:

- session lifecycle
- approval workflows
- event streaming
- mobile clients
- terminal scraping ではなく protocol を話すこと

これは Codex Link の問題意識とほぼ一致する。

参照: https://github.com/openai/codex/issues/11166

## 周辺プロダクト

### Remodex

参照:

- https://www.remodex.site/
- https://github.com/Emanuele-web04/remodex

観測:

- iPhone から Codex を操作する open-source bridge。
- npm bridge、iOS app、QR pairing、E2E encryption を前面に出している。
- bridge が `codex app-server` を spawn または既存 endpoint に接続し、JSON-RPC を中継する。
- macOS では background bridge service / trusted reconnect を持つ。
- self-host relay / Tailscale / reverse proxy subpath を想定している。

Codex Link への示唆:

- iPhone remote control 需要はすでに実プロダクトで存在する。
- QR pairing と trusted reconnect は接続体験として強い。
- `codex app-server` JSON-RPC を bridge が所有し、mobile は bridge protocol を話す構成は Codex Link の方針と合う。

### RemCodex

参照: https://remcodex.com/

観測:

- browser / phone から local Codex session を monitor / approve / interrupt / resume する local-first layer。
- `npx remcodex` で起動し、既定では local port を使う。
- Codex process と code は local machine に残す、という説明が Codex Link と近い。

Codex Link への示唆:

- 「remote desktop ではなく、Codex session control surface」という切り分けが重要。
- approvals、interrupt、resume、readable session history は必須価値。

### Omnara / Happy Coder など

参照:

- https://docs.omnara.com/quickstart
- https://apps.apple.com/us/app/omnara-claude-codex-mobile/id6748426727
- https://github.com/slopus/happy

観測:

- Claude Code と Codex の両方を mobile / web から扱う流れが増えている。
- voice、watch、web、mobile、encrypted relay など、agent control surface は広がっている。

Codex Link への示唆:

- Codex 専用で深く作るなら、ログ欠落なし、Live Activity、iPhone ネイティブ UX、Relay の multi-tenant auth を強みにする必要がある。
- Claude Code 互換に広げる前に、Codex app-server の公式 event model を使い切る方がこのプロジェクトの芯に合う。

## Copilot CLI の remote control

参照: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/steer-remotely

観測:

- Copilot CLI は running session を GitHub.com / GitHub Mobile から見て、permission request に応答し、続きを操作する remote control を公式に持つ。
- `/remote on`、起動時 `--remote`、設定 `remoteSessions` がある。
- QR code、mobile access、keep-alive、previous session review、resume の導線がある。

Codex Link への示唆:

- 目指す UX は奇抜ではなく、すでに競合領域で公式化されつつある。
- Codex Link でも keep-awake / Live Activity / approval-required / resume 導線は重要。

## 結論

Codex Link の方向性は妥当。

ただし MVP の入口は慎重に切る。

- 実装の正本: `codex app-server` event stream。
- 初期 transport: stdio。
- 検証 transport: loopback WebSocket + auth。
- 追跡対象: `codex remote-control`。
- UX の芯: monitor / approve / steer / interrupt / resume / reconnect / Live Activity。

`codex remote-control` が使えるようになったら、Host の起動・登録・再接続モデルを再評価する。
