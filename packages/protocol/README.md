# `@codex-link/protocol`

iPhone app、Relay、Host app が共有する Codex Link protocol 型を置く package です。

この package は Codex app-server の raw JSON-RPC 型ではありません。Host が Codex app-server event を正規化した後の、Codex Link 内部 protocol を定義します。

初期で扱う型:

- User / Device / Host / HostAccess / Connection
- ProjectRef / ThreadRef / TurnRef
- CodexLinkEvent
- ApprovalRequest / ApprovalDecision
- LiveActivityState

実装が始まったら、package manager、build、test コマンドをここに追記します。
