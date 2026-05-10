# UI Design

Codex Link の UI は、旧 `codex-rc` の常用 UI で固めた考え方を引き継ぎます。

参照元:

- `/Users/kite/Developer/codex-rc/docs/web-ui-redesign-plan.md`
- `/Users/kite/Developer/codex-rc/docs/chat-approval-ui-plan.md`
- `/Users/kite/Developer/codex-rc/public/chat/styles.css`
- `/Users/kite/Developer/codex-rc/ios/CodexRC/CodexRC/Views/`

ただし、Codex Link は PWA ではなくネイティブ iPhone app を主導線にします。
そのため、見た目や DOM 構造をコピーするのではなく、情報設計と体験の判断を引き継ぎます。

## 基本思想

- 理想の基本形は、ほぼ ChatGPT の iPhone app そのもの。
- Codex Link は「管理コンソール」ではなく、「ChatGPT app のように自然に開発セッションへ話しかけられるアプリ」にする。
- 通常画面は chat-first / session-first にする。
- ユーザーに `runId`、raw log、raw JSON、Codex app-server JSON-RPC を普段見せない。
- ただし debug / inspector へ降りられる道は残す。
- ユーザーは Host、Project、Thread を選び、下部 composer から指示する。
- 実行中の追加指示は、ユーザーに `steer` と意識させず、同じ composer から送る。
- Stop / Interrupt は composer 付近のいつも同じ位置に置く。
- transcript と timeline は分ける。
- approval は通常の assistant message ではなく、会話内の操作待ちブロックとして出す。
- Live Activity は長文ログではなく、現在状態、最新一文、承認待ちを出す。

## 画面構成

基本の見た目と操作感は ChatGPT app に寄せます。

Codex Link 独自の追加要素は以下に限定します。

- Host 選択
- Project 選択
- timeline
- approval
- sync / reconnect / restored 状態
- Live Activity
- debug / inspector

これらは ChatGPT 的な会話体験を壊さない範囲で足します。
Host / Project / timeline / approval が前面に出すぎて、操作盤や管理画面に見える状態は避けます。

### Home / Host List

アプリ起動直後の理想は、前回開いていた conversation / thread にそのまま戻ることです。
これは ChatGPT app に近い体験を優先するためです。

Host 一覧は、以下の場合に出します。

- 初回起動。
- 前回の Host / Project / Thread が未設定。
- 前回の Host にアクセスできなくなった。
- ユーザーが明示的に Host を切り替える。

表示するもの:

- Host 名
- online / offline
- 最後に見た Project / Thread の短い情報
- 接続問題がある場合の明示的な error

グローバルな Host 一覧は出しません。
Relay が返すのは現在ユーザーがアクセスできる Host だけです。

### Project / Thread Drawer

Host を選んだ後は、左側 drawer または sheet で Project と Thread を選べるようにします。

drawer row に出すもの:

- Project 名
- Project hint。長い path は短くする。
- Thread title
- 最終更新時刻
- preview
- running / completed / failed / canceled / waiting_for_approval

`codex-rc` の教訓として、UUID だけの thread title は通常 UI に出しすぎないでください。
title が取れない場合は、最初の user message や preview から派生します。

### Session Screen

Session 画面が本体です。

理想形は ChatGPT の conversation screen です。
画面の中心は会話であり、timeline や approval は会話の流れに沿って必要な時だけ見える補助情報です。

上から順に:

1. Header
2. compact status bar
3. transcript
4. timeline / activity projection
5. approval block
6. composer

Header:

- 左: drawer
- 中央: `Host / Project / Thread title`
- 右: new thread、more / settings

ChatGPT app に近く、Header は薄く、本文の邪魔をしない密度にします。
Host / Project は常時フォームとして出さず、title / drawer / settings で確認できる程度にします。

Status bar:

- Host connection
- sync / reconnecting / restored
- current turn status
- model / thinking depth は composer か settings の近くに置く

通常画面に常時出さないもの:

- raw event JSON
- stdout / stderr
- app-server request id
- Relay sequence number

ただし、sync 状態や再接続状態を判断するため、内部状態としては sequence を持ちます。

## Transcript

Transcript は読むための領域です。

ここが主役です。
Codex Link を使っている間、ユーザーは「ChatGPT に指示している」感覚で使えるべきです。

表示するもの:

- user message
- assistant delta / final
- failed / canceled / timed out
- approval 待ちの結果

方針:

- assistant の生成中テキストは同じ message を更新する。
- final response は欠落しないよう `assistant.final` を優先する。
- `transcript.item.recorded` は再接続後の復元に使う。
- message は card を重ねすぎず、会話 scroll として扱う。

## Timeline

Timeline は作業の進行を追うための領域です。

Timeline は ChatGPT 体験に対する Codex Link の追加価値です。
ただし常に大きく主張させず、必要に応じて展開できる activity として扱います。

表示するもの:

- command execution
- file change
- tool call
- reasoning / plan
- approval lifecycle
- warning / error

方針:

- running 中の current item は目立たせる。
- completed item は折りたためるようにする。
- 完了後も timeline を消さない。
- `codex-rc` の教訓として、completed turn の event があとから縮んで消えるような扱いはしない。

## Approval UI

Approval は「操作待ち」です。

表示位置:

- 対象 turn の transcript / timeline の近く。
- 画面上部だけの banner に閉じ込めない。
- running status と同じ流れで見えるようにする。

表示するもの:

- 種別: command / file change / network / user input
- command
- cwd
- reason
- 対象 item
- available decisions

操作:

- 許可
- セッション中許可
- 拒否
- キャンセル

二重押しは防ぎます。
押下成功だけで即座に消さず、Host から `approval.resolved` または次の turn status が届くまで解決中として表示します。

## Composer

Composer は下部固定です。

Composer は ChatGPT app にかなり寄せます。
ユーザーが最も触る場所なので、Host / Project / run の都合を感じさせないようにします。

必要なもの:

- text input
- send
- running 中の stop / interrupt
- model selector
- thinking depth selector
- attachment button

方針:

- running turn が選択されている場合、send は `turn/steer` にする。
- idle / completed thread では send は `turn/start` にする。
- unsupported な操作は fallback せず error にする。
- send と stop は毎回同じ位置に置く。
- composer が transcript の最終行を隠さないよう、下部 padding を持つ。

## Live Activity

Live Activity は簡潔にします。

表示するもの:

- Host 名
- Project 名
- status
- latest text
- approval required

表示しないもの:

- raw log
- 長い command output
- JSON

## Visual Direction

ネイティブ iOS の作法を優先します。

- 全体の操作感は ChatGPT app を基準にする。
- 色は light / system background を基準にする。
- 操作盤として静かで、情報密度を高める。
- 8px 前後の控えめな角丸を基本にする。
- 装飾的な hero、過剰な gradient、意味のない card layout は使わない。
- icon button は SF Symbols を使う。
- 長い command / path / reason は折り返し、横 overflow を出さない。
- compact な status pill は使ってよい。
- approval は黄色系、失敗は赤、成功は緑、running は青緑系を基本にする。

## codex-rc から引き継ぐ教訓

- 通常 UI と debug UI を分ける。
- 常用 UI の主語は run ではなく conversation / thread。
- session drawer には project label を必ず出す。
- running 中の追加指示は steer として自然に送る。
- approval block は通常 UI に出す。
- approval block は pending source of truth と解決中状態を分ける。
- iPhone では header と composer の余白を詰め、情報密度を上げる。
- 最新の running activity だけを強調し、完了済みログまで動かし続けない。
- debug / inspector は残すが、普段の操作導線にしない。

## Codex Link で変える点

- VS Code 依存の runner / PWA 前提には戻らない。
- Relay / Host / iPhone の境界を守る。
- iPhone は raw Codex app-server を直接話さない。
- Host が Codex event を Codex Link event に正規化する。
- UI は Codex Link event projection を読む。
- App Store を長期目標にするため、ネイティブ iOS 実装を主導線にする。
