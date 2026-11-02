#!/bin/bash
# 共通知識基盤 (naki0227/personal-knowledge) をセッション開始時に用意し、
# 読む・更新するルールを毎回セッションの文脈に載せる。
# 指示ファイルに書くだけでは読みに行かれず、クラウドでは Vault 自体が無いことが多いため。
# 失敗してもセッションは止めない (常に exit 0)。
set -uo pipefail

note="02-Projects/Repository-Memories/job-match-analysis.md"
vault="${PERSONAL_KNOWLEDGE_DIR:-$(dirname "${CLAUDE_PROJECT_DIR:-$PWD}")/personal-knowledge}"

# ローカル端末の Clone は利用者が管理しているので、取得・更新はクラウドだけで行う
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  if git -C "$vault" rev-parse --git-dir >/dev/null 2>&1; then
    timeout 60 git -C "$vault" pull --ff-only -q >/dev/null 2>&1 || true
  else
    timeout 300 git clone --depth 1 -q https://github.com/naki0227/personal-knowledge "$vault" >/dev/null 2>&1 || true
  fi
  # Vault の pre-push 検査 (frontmatter・リンク・機密パターン) を有効にする
  git -C "$vault" config --local core.hooksPath .githooks >/dev/null 2>&1 || true
fi

if [ -f "$vault/AGENTS.md" ]; then
  cat <<MSG
[共通知識基盤] naki0227/personal-knowledge を $vault で読める。このリポジトリの CLAUDE.md の手順に従うこと。
- 作業開始時: $vault/$note を読み、今回の技術名・問題の種類で rg 検索して [[リンク]] をたどる。参照したノート (なければ「該当なし」) を最初の報告に1行書く。
- 作業終了時: 再利用できる設計判断・不採用理由・不具合やレビューの教訓があれば Vault の既存ノートを更新して PR にする。なければ最終報告に「Vault更新なし（理由）」と書く。
MSG
else
  cat <<MSG
[共通知識基盤] naki0227/personal-knowledge がこのセッションにない ($vault)。
作業前に add_repo (owner: naki0227, repo: personal-knowledge) で追加して $vault に clone し、このリポジトリの CLAUDE.md の手順に従うこと。
ローカル端末で別の場所に Clone がある場合は、環境変数 PERSONAL_KNOWLEDGE_DIR でその場所を指定する。
追加できなければ、最終報告に「Vault未検索・未更新（理由）」と書く。
MSG
fi
exit 0
