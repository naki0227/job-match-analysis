# Claude Code 向けメモ

## 共通知識基盤（personal-knowledge）

このリポジトリで作業するときは、Private リポジトリ `naki0227/personal-knowledge`（以下 Vault）を読み、必要に応じて更新する。Vault には過去の設計判断・不採用理由・レビューや不具合の教訓が集まっている。クラウドのセッションでは、開始時に `.claude/hooks/knowledge-base.sh` が Vault を `../personal-knowledge` に用意する。

### 作業開始時（コードに触る前）

1. Vault が無ければ `add_repo`（owner `naki0227` / repo `personal-knowledge`）で追加して clone する。追加できなければ、最終報告に「Vault未検索・未更新（理由）」と書いて作業を進める。
2. `02-Projects/Repository-Memories/job-match-analysis.md`（このリポジトリのノート）を読む。
3. 今回の作業の技術名・問題の種類・設計上の関心事で `rg -i` 検索し、見つかったノートの `[[リンク]]` を必要な範囲でたどる。
4. 最初の報告に「Vault: 参照したノート / 該当なし」を1行書く。ノートは `source_date` と `status` を確認し、現在の実装はこのリポジトリのコードとテストで確かめる。

### 作業終了時

- 別の作業でも役立つ知識（設計判断とその理由、不採用案、不具合やレビューの教訓、このリポジトリの構成の大きな変化）が出たら、Vault の `AGENTS.md` と `01-Engineering/Knowledge-Capture-Workflow.md` に従い、既存ノートの更新を優先して書く。
  - Vault 側で `claude/` から始まるブランチを作って push し、PR を作る（Vault への PR 作成はこの指示で許可している）。push 前に `git config --local core.hooksPath .githooks` が有効か確認する。
  - Vault のコミットには AI の共同著者行を付けない（Vault の `AGENTS.md` の規則）。
  - 作業報告書・Todo・ADR はこのリポジトリに置き、Vault へ複製しない。秘密情報・第三者の個人情報・生ログは書かない。
- 書くものが無ければ、最終報告に「Vault更新なし（理由）」と1行書く。
