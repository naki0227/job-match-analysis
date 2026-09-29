# Job Match Analysis

ユーザー自身の仕事観と、公開されている企業・求人情報を照合するキャリア検討支援ツール。採否や能力を判定するサービスではありません。

## 開発環境

Node.js 24、pnpm 11、DB統合テスト用のDockerを用意する。ルートで `pnpm install --frozen-lockfile` を実行する。ローカルのGoogleログインを試す場合は `apps/api/.env.example` と `apps/web/.env.example` を各ディレクトリの `.env.local` にコピーし、[Auth設定](docs/auth.md)に従ってSupabaseの値を入れる。secret keyはAPI側だけに置く。共有解析POSTを使うときはAPI側の`ANALYZER_VERSION`と`ANALYSIS_FRESHNESS_SECONDS`も設定する。鮮度期間の値は運用上の判断として空欄のまま提供する。

2つのターミナルで `pnpm --filter api dev` と `pnpm --filter web dev` を実行する。画面の見た目だけを確認する場合は、Webのdev serverで `http://localhost:5173/#ui-preview` を開くと、全画面を架空のサンプルデータで表示できる（開発時のみ）。Webの `http://localhost:5173` は `/api/health` をAPIの `http://localhost:3000/health` に転送する。

| コマンド | 確認内容 |
|---|---|
| `pnpm format:check` | Prettier |
| `pnpm lint` | TypeScriptコードのlint |
| `pnpm typecheck` | contracts/domain/application/Crawler/API/Webの型検査 |
| `pnpm test` | contracts/domain/application/Crawler/API/Webのunit test |
| `pnpm build` | contracts/domain/application/Crawler/API/Webのbuild |
| `pnpm test:db` | Docker上のPostgreSQL migration・制約・RLS・rollback |
| `pnpm test:auth` | ローカルSupabase AuthとAPIの統合確認 |
| `pnpm test:e2e` | ログイン済みfixtureを使うPlaywrightの診断保存・再読込テスト（ローカルChromeが必要） |
| `pnpm precommit` | format・lint・typecheck・test・buildを順に実行 |

依存方向はWeb → `packages/contracts`、API → `packages/application` → `packages/domain`（`@job-match/domain`）と`packages/contracts`。純粋なdomainはZod、HTTP、DBへ依存しない。共有パッケージを変更したら、API/Webをbuildする前に contracts → domain → application の順にbuildする。rootのtypecheck/buildとCI/Dockerはこの順序を含む。

コンテナのビルド確認は、ルートから `docker build -f apps/api/Dockerfile -t job-match-api:local .` と `docker build -f apps/web/Dockerfile -t job-match-web:local .` を実行する。

## 設計ドキュメント

- [総合設計書](docs/design.md)
- [アプリケーション構成・処理フロー](docs/architecture.md)
- [DB論理設計・ER図・整合性](docs/database.md)
- [インフラ構成・GitOps・運用](docs/infrastructure.md)
- [API契約と非同期ジョブ](docs/api.md)
- [設計判断・未確定事項](docs/decisions.md)
- [MVPの就業価値観8軸](docs/assessment-axes.md)
- [MatchEngineの判定規則](docs/matching.md)
- [開発運用・Issueの進め方](docs/development.md)
- [Googleログインと個人データ権限](docs/auth.md)
- [UIモック](apps/web/mock/README.md)（Web画面の見た目の基準。マスコット素材は`apps/web/src/assets/mascot/`）

**実装方針:** コードは開発者が手書きする。ここにある図には実装済み部分と設計案があり、実測・技術スパイクにより更新する。課題はGitHub Issuesの受け入れ条件を単位に進める。

## Issues / 進め方

コミット前のローカル検証を有効にするには、初回に `git config --local core.hooksPath .githooks` を実行する。以後のコミットでは `pnpm precommit` が走り、format check・lint・typecheck・test・buildを確認する。必要なら同じコマンドを手動でも実行できる。

Issue #14〜#17のPostgreSQL migrationは `pnpm test:db` で検証する。Docker上の一時的なPostgreSQL 17を使い、up・制約違反・RLS・rollbackを確認する。実際のSupabaseへはこのコマンドで接続しない。ローカルSupabaseを起動した後のAuthとData APIの統合確認は `pnpm test:auth` で行う。

- [全Issue](https://github.com/naki0227/job-match-analysis/issues)
- [技術スパイク Epic #1](https://github.com/naki0227/job-match-analysis/issues/1)
- [診断・Matchドメイン Epic #2](https://github.com/naki0227/job-match-analysis/issues/2)
- [DB・Auth Epic #3](https://github.com/naki0227/job-match-analysis/issues/3)
- [共通解析ジョブ Epic #4](https://github.com/naki0227/job-match-analysis/issues/4)
- [UIと結果 Epic #5](https://github.com/naki0227/job-match-analysis/issues/5)
- [品質 Epic #6](https://github.com/naki0227/job-match-analysis/issues/6)
- [GitOps/Infra Epic #7](https://github.com/naki0227/job-match-analysis/issues/7)

README・ドキュメント・Issueには実装済みの内容と後続Issueの設計案が混在する。本番環境へのデプロイはまだ行っていない。
