# Job Match Analysis

ユーザー自身の仕事観と、公開されている企業・求人情報を照合するキャリア検討支援ツール（設計段階）。採否や能力を判定するサービスではありません。

## 設計ドキュメント

- [総合設計書](docs/design.md)
- [アプリケーション構成・処理フロー](docs/architecture.md)
- [DB論理設計・ER図・整合性](docs/database.md)
- [インフラ構成・GitOps・運用](docs/infrastructure.md)
- [API契約と非同期ジョブ](docs/api.md)
- [設計判断・未確定事項](docs/decisions.md)
- [開発運用・Issueの進め方](docs/development.md)

**実装方針:** コードは開発者が手書きする。ここにある図は現時点の設計案であり、実測・技術スパイクにより更新する。課題はGitHub Issuesの受け入れ条件を単位に進める。

## Issues / 進め方

- [全Issue](https://github.com/naki0227/job-match-analysis/issues)
- [技術スパイク Epic #1](https://github.com/naki0227/job-match-analysis/issues/1)
- [診断・Matchドメイン Epic #2](https://github.com/naki0227/job-match-analysis/issues/2)
- [DB・Auth Epic #3](https://github.com/naki0227/job-match-analysis/issues/3)
- [共通解析ジョブ Epic #4](https://github.com/naki0227/job-match-analysis/issues/4)
- [UIと結果 Epic #5](https://github.com/naki0227/job-match-analysis/issues/5)
- [品質 Epic #6](https://github.com/naki0227/job-match-analysis/issues/6)
- [GitOps/Infra Epic #7](https://github.com/naki0227/job-match-analysis/issues/7)

最初は[Issue #8: Jev API実契約の確認](https://github.com/naki0227/job-match-analysis/issues/8)。README・ドキュメント・Issueは設計案であり、アプリケーションや本番環境はまだ実装・デプロイしていません。
