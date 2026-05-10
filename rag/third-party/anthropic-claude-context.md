# Anthropic Claude Context / Token Management 仕様メモ

このファイルは、Claude の context / token management 周辺の公式情報を Codex Link 観点で整理するメモです。

公式ドキュメントそのものではありません。実装や設計で見落としたくない要点だけを残します。

## 参照元

確認日: 2026-05-10

- Managing context on the Claude Developer Platform
  https://claude.com/blog/context-management

- Context editing
  https://platform.claude.com/docs/en/build-with-claude/context-editing

- Memory tool
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool

- Context windows
  https://platform.claude.com/docs/en/build-with-claude/context-windows

- Migration guide
  https://platform.claude.com/docs/en/about-claude/models/migration-guide

## 何が画期的か

Claude の最近の重要な更新は、単に context window が大きくなったことではありません。

より重要なのは、長時間エージェントの token 管理を、開発者が自前で全部作らなくてよくなってきたことです。

中心になる機能:

- context editing
- memory tool
- server-side compaction
- token-efficient tool use
- extended thinking / thinking block clearing
- 1M-token context window

## Context Editing

Context editing は、会話履歴が膨らんだときに、Claude API 側で不要になった内容を選択的に消す仕組みです。

重要な点:

- beta header は `context-management-2025-06-27`。
- server-side で、モデルへ届く前に適用される。
- client は完全な会話履歴を保持し続けてよい。
- tool result clearing は `clear_tool_uses_20250919`。
- thinking block clearing は `clear_thinking_20251015`。
- token counting endpoint でも context management 後の token 数を確認できる。
- streaming response では最終 `message_delta` に `context_management.applied_edits` が入る。

Codex Link への示唆:

- 長時間セッションのログ正本と、モデルに渡す active context は分けるべき。
- 古い tool results は、UIの履歴には残しても、モデル context からは落とせる。
- 「ログ欠落なし」と「token効率」は両立できる。
- Codex Link の event cache / transcript / timeline 設計にも同じ分離を採用する。

## Memory Tool

Memory tool は、Claude が context window の外に情報を保存・参照できる仕組みです。

重要な点:

- beta header は `context-management-2025-06-27`。
- Claude が dedicated memory directory に file を create/read/update/delete できる。
- storage backend は developer 側が管理する。
- 会話をまたいで知識や作業状態を維持できる。
- context editing と組み合わせると、消される前に重要情報を memory に保存できる。

Codex Link への示唆:

- Codex Link でも、session log と別に「要約された作業記憶」を持つ価値がある。
- Host 側に project memory / session memory / user preference memory を分けて持つ設計が考えられる。
- Relay が raw project data を持たない方針と相性がよい。memory の正本は Host 側に置ける。

## Server-side Compaction

Compaction は、長くなった会話を要約して続行するための仕組みです。

Context editing が tool result を選択的に落とすのに対し、compaction は会話全体を高密度の要約に置き換える方向です。

Codex Link への示唆:

- reconnect 用 event projection と、長期継続用 summary projection は別物として扱う。
- Live Activities や timeline UI には event projection。
- 次の turn に必要な文脈には summary projection。

## Token-efficient Tool Use

Claude 4+ では、以前 beta header が必要だった token-efficient tool use が組み込みになっています。

重要な点:

- 旧 beta header `token-efficient-tools-2025-02-19` は Claude 4+ では不要。
- tool call JSON parsing は標準 JSON parser 前提にする。
- tool 定義や tool result の扱いで token 効率が改善されている。

Codex Link への示唆:

- 最新モデルでは、古い token 節約用 workaround を残さない。
- tool result を全部雑に詰めるのではなく、re-fetch 可能な情報と記憶すべき情報を分ける。

## Extended Thinking / Thinking Block

Claude API は previous thinking blocks を context window 計算から自動的に除外する仕組みを持ちます。

重要な点:

- tool use 中は対応する thinking block を保持する必要がある。
- tool cycle 完了後は previous thinking tokens が context 計算から除外される。
- thinking block clearing で、thinking preservation の量を制御できる。

Codex Link への示唆:

- AI の内部推論表示と、ユーザー向け timeline は分ける。
- reasoning / thinking の扱いは provider ごとに違うので、Codex Link protocol は特定 provider の thinking 表現に依存しすぎない。

## 1M-token Context

Claude Opus 4.7、Opus 4.6、Sonnet 4.6 などでは 1M-token context window が利用可能とされます。

ただし、1M context は「全部入れればよい」という意味ではありません。

Codex Link への示唆:

- 大きな context window は保険として有用。
- それでも context editing / memory / compaction / event projection は必要。
- 大きな context は、コストと速度と quota に影響するため、UIやHost側で token budget を可視化する価値がある。

## Codex Link への設計影響

Claude の更新から学べる設計原則:

- raw log は保存する。
- model context は編集可能にする。
- transcript / timeline / memory / summary を分ける。
- re-fetch 可能な tool result は長期 context に残さない。
- 重要な判断、TODO、失敗原因、環境情報は memory / summary に残す。
- token count / context pressure / compaction status を内部状態として扱う。
- provider が提供する context management 機能を積極的に使う。

Codex Link は OpenAI Codex 中心のプロダクトですが、Claude の context management 設計はかなり参考になります。

特に「ログを消さず、モデルに渡す文脈だけを整理する」という考え方は、Codex Link のログ欠落なし設計にそのまま効きます。
