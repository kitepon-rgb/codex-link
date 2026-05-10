# RAG

このフォルダは、Codex Link の設計や実装時に参照する外部仕様・第三者仕様・公式ドキュメント要約を置く場所です。

`docs/` はプロジェクト自身の仕様と設計を置きます。

`rag/` は、OpenAI や Apple など第三者が管理する仕様を、実装時に参照しやすい形で整理します。

## ルール

- 公式ドキュメントを丸ごとコピーしない。
- 参照元 URL と確認日を書く。
- Codex Link で使う判断だけを日本語で要約する。
- 仕様が変わったら、このフォルダのメモも更新する。
- プロジェクトの意思決定は `docs/` に書く。

## 構成

- `third-party/`: 第三者仕様。

## 取得ツール

外部仕様のMarkdownスナップショットは、以下で更新します。

```bash
node scripts/fetch-rag-source.mjs
```

特定ソースだけ更新する場合:

```bash
node scripts/fetch-rag-source.mjs openai-codex-remote-connections
```

取得対象は `rag/sources.json` に定義します。

現時点では Jina Reader を使います。URLの内容をLLM向けMarkdownに変換し、必要に応じて本文開始位置でトリミングします。

生成された `*.source.md` は第三者仕様のスナップショットです。プロジェクトとしての解釈や判断は、別の要約メモまたは `docs/` に書いてください。
