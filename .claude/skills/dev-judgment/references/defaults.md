# 本人の既定値（迷ったらこれで決める）

本人（naki0227）の判断・反省・指示から作った既定値。`出典` は Vault（`../personal-knowledge`）のノート。
このファイルは公開リポジトリにも配られる。会社名・選考・インターンなど本人の個人的な事情は書かず、学びだけを書く（詳しい経緯は出典のノートにある）。
**既定値は、そのリポジトリの規約・今回の指示・計測結果より弱い。** ぶつかったら、そちらに従い、ずれを報告に書く。古い記録（`source_date`）は、今の事情と合うか確かめてから使う。

## 範囲
- 頼まれていない拡張をしない。仕様にない入力欄・DB の列・状態を足さない。要件が無い部分は、選んだ理由を残す。
  出典: `06-Personal/decision-journal-2026.md`（2026-09-23 の設計課題）
- 途中で見つけた別の問題は、同じ PR で直さない。報告に書くか、別のタスクにする。
  出典: `01-Engineering/global-development-rules.md` §8
- 「最小の差分」は行数ではなく、新しい概念・依存・保守の手間が増えないこと。
  出典: `06-Personal/technical-skills-and-principles.md`

## 設計
- 新しい仕組みを作る前に、同じ仕事をする既存の実装・helper・framework の標準機能を2〜3件探す。無い、または使えない理由を言えるまで作らない。
  出典: `06-Personal/technical-skills-and-principles.md`（Rails のテスト移行で独自 helper を作り直した反省）
- AI や生成のような曖昧な処理と、決まった結果を出す処理を、中間の契約（JSON・スキーマ・型・AST）で分ける。AI 用のツールは、引数を持つ決定的な関数や CLI にし、help とエラーで AI が直せるようにする。
  出典: `01-Engineering/Repository-Lessons/deterministic-contracts.md`、`06-Personal/decision-journal-2026.md`（2026-08-20）
- 境界（依存の向き、層、欠けてはいけない項目）は、文章だけでなく型・ビルド・テスト・静的検査で壊れるようにする。
  出典: `01-Engineering/Cross-Repository-Review-2026-10.md`
- 時刻・乱数・外部 I/O は差し替えられるようにして、テストで境界の時刻を再現する。
  出典: `06-Personal/decision-journal-2026.md`（2026-09-23 テストできる時計）
- データは手元で持てるなら手元で持つ。外に送るのは必要なものだけ。
  出典: `01-Engineering/Repository-Lessons/local-first-and-privacy.md`
- ユーザーの状態を黙って変えない。置き換えるより、差分を見せて確かめてもらう。AI の提案と、実際の実行・送信は別の状態にする。
  出典: `01-Engineering/Repository-Lessons/ai-human-approval.md`

## 依存の追加・更新
- 足す前に、標準ライブラリと今ある依存で済まないか比べる。足すなら理由・保守・脆弱性・運用の手間を書く。
  出典: `01-Engineering/global-development-rules.md` §5
- 更新は「警告が消えた」で終わりにしない。生成物（prebuild など）・SDK の初期化・ビルド・CI・ほかの依存との両立を確かめる。品質ツールの更新は、検知できる範囲が変わっていないかを、わざと問題を入れた対照実験で測る。
  出典: `06-Personal/github-pr-issue-lessons-2026-10.md`（gojuon-minesweeper PR #75、useful-map PR #3）
- 脆弱性対応の更新で機能が静かに壊れる恐れがあるなら、更新を保留して理由を記録する（これは AI が決めてよい）。
  出典: 同上（Expo SDK 58 の保留）
- バージョンは固定する。無条件の `latest` を使わない。
  出典: `01-Engineering/global-development-rules.md` §9

## DB・API・認可
- 一意性はアプリの事前確認だけに頼らず、DB の UNIQUE 制約で最後に守る。競合時のエラーと、必要なら冪等性も作る。
  出典: `06-Personal/technical-skills-and-principles.md`
- 索引は慣習ではなく、実際の検索条件で決める。DDL と EXPLAIN を見ないまま「こちらが速い」と言わない。
  出典: `06-Personal/technical-skills-and-principles.md`（2026-10-27 の学び）
- UI で呼ばないことは認可ではない。権限と不変条件はバックエンドで強制する。
  出典: 同上
- 認可・監査・マスキングは、失敗したときに許可側に倒れないようにする。fail-closed と書くなら、守れる範囲を正確に書き、強く書きすぎない。
  出典: `06-Personal/github-review-coverage-and-standards-2026.md`、`01-Engineering/Engineering-Review-Principles.md`
- 互換を壊す変更（公開 API、保存形式、破壊的 migration）は段階的に移す。旧版との共存と戻し方を先に書く。
  出典: `01-Engineering/global-development-rules.md` §6

## 費用・障害・性能
- 構成を決める前に、費用と「どこまでの障害を許さないか」を数字にする。数字の前提（時点・無料枠・量）も書く。上限が本人しかわからないときは戻す（dev-judgment §3）。
  出典: `06-Personal/operations-costs-and-failure-learning.md`（費用を測らずに構成を決めた反省）
- 障害時の体験も要件に入れる：止まったのか終わったのかの区別、待機画面、一斉の再接続で負荷が集中しないこと。外部サービスの失敗と自分の処理の失敗を、利用者に取り違えて見せない。
  出典: 同上、`06-Personal/github-pr-issue-lessons-2026-10.md`（job-match-analysis Issue #85）
- 性能は測ってから優先度を決める。目標内なら直すのを後回しにし、測る条件をタスクに残す。
  出典: `06-Personal/github-pr-issue-lessons-2026-10.md`（job-match-analysis Issue #83）

## テスト
- テストは実装の写しではなく、利用者やドメインから見える保証・境界値・異常系を確かめる。わざと実装を壊して、そのテストが落ちるかを見る。
  出典: `06-Personal/technical-skills-and-principles.md`
- 安全性は反例で壊して確かめる：紛らわしい設定、無効な入力、権限の欠け、競合。正常系が緑でも安全とは言わない。
  出典: `06-Personal/github-review-coverage-and-standards-2026.md`
- 検証の深さは、規模・期間・失敗したときの影響で決める。DB・認可・IaC などリスクの高い所を厚く、低リスクの所は自動チェックに任せる。
  出典: `06-Personal/team-development-and-review-lessons.md`、`06-Personal/technical-skills-and-principles.md`
- CI が無いリポジトリで続けて開発するなら、機能より先に最小の CI を入れる（別のコミット）。
  出典: `01-Engineering/global-development-rules.md` §3

## UI
- Web のページ・画面を作るなら、`site-skills` のスキルがあればそちらを先に使う。
- 避ける：意味のないグラデーション、カードの乱用、どこも同じ角丸、飾りすぎ、説明しすぎの SaaS テンプレート感。
- 個性は色だけでなく、文字・配置・形・アイコン・動き・情報の量で出す。主役を1つ決め、ほかは支える側に回す。重くなる演出は削る。
- 状態は色だけで表さない（アイコン・位置・文字・進み具合を合わせる）。普段は静かに、エラーはその場所ではっきり。軽くて戻せる操作は即時反映と取り消し、壊す操作は事前に確認。
- アクセシビリティ（コントラスト・フォーカス・キーボード・読み上げ・動きを減らす設定）は最初から条件に入れる。
- 製品に固有の色が無いときの既定：主色は水色、強調にオレンジ。作品に世界観があるときは作品を優先し、ほかの作品に似せない。
  出典: `06-Personal/collaboration-and-communication.md`（2026-08-23 の Notion の判断基準を含む）、`06-Personal/further-decisions-from-chat-history-2026.md` §4

## 任せる範囲・学び
- 既定は「全部 AI で進める」（2026-11-03 の本人の回答）。DB・認証・インフラも、dev-judgment §2 を満たせば AI が決める。
- そのかわり、本人があとで読んで学べるように、判断の理由・採らなかった案・見直す条件を必ず残す。本人が「ここは自分で書く／考える」と言ったときだけ、解説と最小の差分にとどめる。
  出典: 今回の指示（2026-11-03）、`06-Personal/further-decisions-from-chat-history-2026.md` §5（以前は DB やインフラを自分で考えたい時期があった）

## 文章・報告
- 結論から。短く、自然な日本語で、根拠をつける。前置き・飾り・長い背景はいらない。
- 事実・本人の判断・AI の推測を分ける。やっていないことを、やったと書かない。
  出典: `06-Personal/collaboration-and-communication.md`
- 外部（企業・相手）への文は、誠実・簡潔・謝りすぎない・状況と依頼をはっきり。送るのは本人（dev-judgment §4）。
  出典: 同上
