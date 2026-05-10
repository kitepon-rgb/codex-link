# Codex Link Docs

このディレクトリは、Codex Link の仕様と設計を置く場所です。

まず読むべき入口は `requirements.md` です。

## 現役ドキュメント

1. [requirements.md](requirements.md)
   プロダクトが必ず満たすべき要件。最初に読むマスター仕様書。

2. [architecture.md](architecture.md)
   iPhone app、Relay、Host、ローカル Codex の構成と責務。

3. [security-model.md](security-model.md)
   認証、認可、マルチテナント、Relay が持ってよい情報と持ってはいけない情報。

4. [mvp-plan.md](mvp-plan.md)
   MVP までの作業順、実装 TODO、やりすぎない範囲。

5. [ui-design.md](ui-design.md)
   旧 `codex-rc` の見本から引き継ぐ UI 方針と、Codex Link のネイティブ iPhone UI 設計。

## 背景資料

古い検討メモや、`requirements.md` に統合済みの内容は [archive/](archive/) に置きます。

第三者仕様や公式ドキュメント要約は [../rag/](../rag/) に置きます。

## 重要な決定

- Codex Link は、旧 `codex-rc` が目指した理想を作り直して叶えるプロジェクト。
- iPhone から、ローカル端末上の開発セッションを操作できるようにする。
- iPhone app の通常体験は、Host 管理画面ではなく ChatGPT app に近い conversation screen にする。
- セッション状態、AI の動作状態、ログ、Live Activities をわかりやすく見せる。
- Host は、可能な限りインストールコマンド一発で設定できるようにする。
- Relay ドメインは複数ユーザーと複数 Host が接続する共有ハブ。
- Relay はマルチテナント前提で、認証と認可を必須にする。
- Relay は Codex を実行しない。
- Host がローカル Codex とローカル副作用を担当する。
- Codex remote connections / app-server を中核として使う。
- Codex の最新公式仕様は [../rag/third-party/openai-codex.md](../rag/third-party/openai-codex.md) と公式ドキュメントで確認する。
- iPhone app は SSH クライアントにしない。
- グローバルな Host 一覧を返してはいけない。
- App Store 公開は長期目標。ただし MVP では公開までやりきらない。
