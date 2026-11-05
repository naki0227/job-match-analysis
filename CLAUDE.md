# Claude Code 向けメモ

## 共通知識基盤（personal-knowledge）

このリポジトリで作業するときは、Private リポジトリ `naki0227/personal-knowledge`（以下 Vault）を読み、必要に応じて更新する。Vault には過去の設計判断・不採用理由・レビューや不具合の教訓が集まっている。クラウドのセッションでは、開始時に `.claude/hooks/knowledge-base.sh` が Vault を `../personal-knowledge` に用意する。

### 作業開始時（コードに触る前）

1. Vault が無ければ `add_repo`（owner `naki0227` / repo `personal-knowledge`）で追加して clone する。追加できなければ、最終報告に「Vault未検索・未更新（理由）」と書いて作業を進める。
2. `02-Projects/Repository-Memories/job-match-analysis.md`（このリポジトリのノート）を読む。無ければ作業終了時に、README と構成を確かめて既存ノートと同じ形式で作る。
3. 今回の作業の技術名・問題の種類・設計上の関心事で `rg -i` 検索し、見つかったノートの `[[リンク]]` を必要な範囲でたどる。
4. 最初の報告に「Vault: 参照したノート / 該当なし」を1行書く。ノートは `source_date` と `status` を確認し、現在の実装はこのリポジトリのコードとテストで確かめる。

### 作業終了時

- 別の作業でも役立つ知識（設計判断とその理由、不採用案、不具合やレビューの教訓、このリポジトリの構成の大きな変化）が出たら、Vault の `AGENTS.md` と `01-Engineering/Knowledge-Capture-Workflow.md` に従い、既存ノートの更新を優先して書く。
  - Vault 側で `claude/` から始まるブランチを作って push し、PR を作る（Vault への PR 作成はこの指示で許可している）。push 前に `git config --local core.hooksPath .githooks` が有効か確認する。
  - Vault のコミットには AI の共同著者行を付けない（Vault の `AGENTS.md` の規則）。
  - 作業報告書・Todo・ADR はこのリポジトリに置き、Vault へ複製しない。秘密情報・第三者の個人情報・生ログは書かない。
- 書くものが無ければ、最終報告に「Vault更新なし（理由）」と1行書く。

## AIの判断（dev-judgment / dev-workflow）

このリポジトリでは `.claude/skills/` のスキル（dev-lifecycle / dev-judgment / dev-workflow、iOS アプリなら app-quality-bar）に従う。正本は Vault の `templates/repo-bootstrap/.claude/skills/` で、ここを直接直さない（Vault で直して `scripts/install_repo_bootstrap.py` で写す）。

- 何かを作る・良くするときは、`dev-lifecycle` で本人の開発の流れ（課題 → 当然を疑う → 影響 → 何を作るか → 制約 → 作り方 → 形 → 実装 → テスト → 性能・E2E → リリース → 運用）に沿って深く考える。依頼をそのまま作り始めない。
- iOS アプリ・ゲームの画面と中身は、`app-quality-bar` の基準（StudyReel のトーン、題材の世界観を部品にする、手応えの表、毎日開く理由、全状態、撮って採点して合計 20 以上）に届くまで完成にしない。
- コードを変える作業の始めと終わり（「完了」と言う前、PR を出す前）は `dev-workflow` を使う。
- 途中で「どちらにするか」迷ったら `dev-judgment` を使う。材料がそろっていて最適と言えるなら AI が決めて理由を残し、本人しか知らない事実で答えが変わるなら本人に戻す。データの削除・外部への送信や公開・既定ブランチへの直接 push・お金がかかる操作は、必ず実行前に確認する。
- このリポジトリの規約や今回の指示が、スキルの既定値とぶつかるときは、規約と指示を優先し、ずれを報告に書く。
