# 開発運用・手書き実装ガイド

## 開発方針

このリポジトリのプロダクションコードは開発者が自分で手書きする。設計ドキュメントとIssueには「何を保証するか」「どう検証するか」を書き、完成コードの一括生成は開発プロセスの目的に含めない。AIとの相談では、実装前の責務分離・設計理由の解説、実装途中の問題切り分け、差分レビュー、テスト観点の提示を主軸とする。

## Scrum-lite

1週間を1スプリントの目安にする（固定の納期は設けない）。開始時に小さなスプリント目標とその達成に必要なIssueを選び、終了時に動くもののデモ・次の改善を記録する。ボードは Backlog → Ready → In Progress（WIP 1）→ Review/Test → Done。依存が満たされていないIssueはBlockedとして扱う。

**相対優先度の数字を振らない。** 作業順序は「この機能を完成させるための依存関係」とマイルストーンで表す。Epicは複数Issueをまとめる親のチェックリストであり、一度に実装する巨大なIssueではない。

## マイルストーン（機能とインフラは独立）

~~~mermaid
flowchart LR
  spike["M0 Jev/取得/ARM64技術スパイク"]
  domain["M1 診断軸・Matchドメイン"]
  db["M2 DB・認証"]
  queue["M3 URL共有ジョブ"]
  analyzer["M4 Crawler・Jev評価"]
  ui["M5 個人診断UI・相性"]
  quality["M6 品質・ローカルE2E"]
  ops["M7 Terraform/GHCR/k3s/Argo CD/Grafana"]
  spike --> domain --> db --> queue --> analyzer --> ui --> quality
  spike -. "ARM64結果を反映" .-> ops
  quality -. "公開前に接続" .-> ops
~~~

M7はプロダクトのMVPローカル完成を阻害しない独立ストリーム。ただし本番公開する際にはSecurity・Backup・Observabilityの受け入れ条件を満たす必要がある。

## IssueのDefinition of Ready

背景・スコープ、非スコープ、入出力／不変条件、依存関係、受け入れ条件、テスト方法が書かれていること。外部APIや不明仕様が障害なら先に短い技術スパイクを立てること。

## IssueのDefinition of Done

- Close前にIssue本文の各Acceptance Criteriaとテスト項目を実際の差分・実行結果に照合し、達成したチェックボックスを更新する。未達の必須項目があればCloseしない。
- 設計された成功・異常・競合のケースが動作し、Vitest / DB integration / Playwright等適切な層でテストされている。
- PRの型チェック、lint、テスト、必要なImage buildが通る。
- スキーマ変更にはSQL migration、外部公開仕様変更にはdocs/API契約変更を添える。
- 例外・ログにトークン／個人プロフィール本文が混入せず、個人データの所有者を検査できる。
- 変更理由・未解決のトレードオフを本人が説明でき、必要ならADRへ記録する。

## 想定する実装サイクル

Issueで背景と受け入れ条件を確認 → 相談して実装手順を理解 → 開発者が手書き → tests → PRで差分レビュー → 本人が修正・merge → Issueを閉じる。

CIは成功の証拠だが、診断の妥当性・求人情報の鮮度・規約順守・個人情報の扱いはCI greenだけでは証明されない。

## CIの実行範囲

- 通常CIは全push/PRでcontracts、domain、api、crawler、format、Docker image buildを確認する。Crawlerのブラウザ通信境界はcrawlerのテストで検証する。
- Web CIは `apps/web/**`、`packages/contracts/**`、root package設定・lockfile、Web workflowの変更時に実行し、lint、unit test、UI導線のPlaywright、buildを確認する。Web Dockerfileも `apps/web/**` に含む。
- DB migration CIはmigration・rollback・DBテスト・検証スクリプト・root package設定の変更時に実行し、migrationとダミーデータ別DB復元を確認する。

## ローカルの起動とテストの順番（Issue #28）

前提はNode.js 24、pnpm 11、Docker。ルートで`pnpm install --frozen-lockfile`を実行する。秘密値は`apps/api/.env.local`・`apps/web/.env.local`・ルートの無追跡`.env`だけに置き、Gitへ入れない。

| 順番 | コマンド | 使うもの | 確認すること | CI |
|---|---|---|---|---|
| 1 | `pnpm precommit` | なし | format・lint・typecheck・unit test（contracts/domain/application/Crawler/API/Web）・build | CI・Web |
| 2 | `pnpm test:db` | Docker上の使い捨てPostgreSQL 17 | 全migration・制約・RLS・RPC・同時実行、HTTP＋DBの統合テスト（解析受付・履歴・共有リンク・worker回復）、セキュリティ権限ガード、rollback | DB migration |
| 3 | `sh scripts/test-db-restore.sh` | 同上 | ダミーデータのdump/restoreとFK・RLS・版履歴 | DB migration |
| 4 | `pnpm test:e2e` | ローカルChrome、API不要（Playwrightが応答をfixtureで返す） | ログイン済み画面の入力・解析・履歴・公開ページの導線 | Web |
| 5 | `docker build -f apps/api/Dockerfile .`／`apps/web/Dockerfile` | Docker | 本番imageのbuild | CI |

- テストはJevの本番APIを呼ばない。Crawlerのunit test・統合テストは`createFakeDecisionEngine`を使い、CIは`JEV_API_KEY`などの秘密値を要求しない。実Jevの確認は`apps/api/scripts/jev-smoke.ts`で低頻度・手動に限る。
- DBのfixtureは`supabase/tests/*.sql`と`apps/api/scripts/test-*-db.ts`に置き、`scripts/test-db-migration.sh`が適用順を管理する。migrationを追加したら、このスクリプトへup・テスト・rollbackを追加する。
- ローカルSupabase（Auth・Data API）は、ルートの`.env`に`GOOGLE_CLIENT_ID`と`GOOGLE_CLIENT_SECRET`を置いて`pnpm exec supabase start`で起動し、`pnpm test:auth`で匿名・本人・サーバー資格情報の境界を確認する（[Auth](auth.md)）。
- 画面を動かす時は2つのターミナルで`pnpm --filter api dev`と`pnpm --filter web dev`を実行する。APIの`.env.local`には`SUPABASE_URL`・`SUPABASE_PUBLISHABLE_KEY`・`SUPABASE_SECRET_KEY`と、`ANALYZER_VERSION`・`ANALYSIS_FRESHNESS_SECONDS`・`ANALYSIS_NEW_URL_LIMIT`・`ANALYSIS_QUOTA_WINDOW_SECONDS`が必要（値は運用判断）。画面の見た目だけなら`http://localhost:5173/#ui-preview`でサンプルデータを表示できる。
- 共有ジョブを実際に処理する場合は、下の「ローカルCrawler worker」の設定でworkerを起動する。

## ローカルCrawler worker

`pnpm --filter crawler build`の後、`pnpm --filter crawler worker`で共有ジョブを処理する。workerは各周期で取得から30日を過ぎた`source_document_versions.extracted_text`を最大指定件数だけNULLにし、次に共有ジョブを1件claimする。終了時はSIGINT/SIGTERMでブラウザを閉じる。

起動前に`SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`JEV_API_KEY`、`CRAWLER_BROWSER_EXECUTABLE`をサーバー側環境変数に設定する。`CRAWLER_LEASE_SECONDS`、`CRAWLER_MAX_ATTEMPTS`、`CRAWLER_RETENTION_BATCH_SIZE`、`CRAWLER_MAX_EXCERPT_CHARS`（情報を捨てる上限ではなく、根拠位置を特定するための1断片サイズ）、`CRAWLER_MAX_EVIDENCE_PER_AXIS`（1軸の根拠の最大件数）、`CRAWLER_POLL_INTERVAL_MS`、Jevへ送る断片数の1日（UTC）あたりの全体上限`CRAWLER_JEV_DAILY_CANDIDATE_BUDGET`も必須で（評価の流れはADR-044）、正の整数か`unlimited`を指定する。本文の断片数・総文字数にアプリ独自の上限は設けない。有限の場合は上限到達後に新規のJev呼び出しを止め、未解決の軸を`unknown`として保存する（評価器版に`jev-budget-exhausted`を含む）。`unlimited`は予算表を参照せず常にJevを呼ぶ。どちらのモードでもJev呼び出しの断片数・軸数・token・結果と、評価ごとのknown/unknown/conflicting数はmetrics portへ記録する。費用と実行環境に応じた値を運用者が指定する。ブラウザへ秘密鍵を渡さない。

`CRAWLER_RUN_MODE=drain`（Azure Container Apps Job用、ADR-040）では`CRAWLER_DRAIN_MAX_JOBS`も必須で、queueが空になるか上限件数に達したら終了する。既定の`loop`は常駐する。

## 運用telemetry（Issue #32、ADR-041）

APIとcrawlerは公式OpenTelemetry SDKをOTLP/HTTPで起動する。`OTEL_EXPORTER_OTLP_ENDPOINT`が未設定なら何も登録せず、計測はno-opになる（ローカル・CIの既定）。Grafana Cloudへ送る場合は、Grafana CloudのOTLP endpointと`OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <instance:token>`をサーバー側の秘密として設定する。任意で`OTEL_SERVICE_NAME`、`DEPLOYMENT_ENVIRONMENT`（既定`production`）、`OTEL_METRIC_EXPORT_INTERVAL`（ms、既定60000）を指定する。exporterやbackendの失敗はdiag loggerで握りつぶし、終了時のflushは最大5秒で打ち切るため、API・crawlerを止めない。span・metricのattributeはroute template・method・status・outcomeだけで、raw path・query・token・利用者情報・本文は送らない。

新規URLは単一の`JobPosting` JSON-LDに求人名と雇用主名がある場合だけ評価対象を作る。構造化メタデータのないページや複数求人の一覧は、誤った企業へ結びつけずジョブを失敗として確定する。robots・公開URL・SSRFの取得境界はADR-021/026/034に従う。

## 不正利用signal（Issue #42、ADR-042）

APIは`ABUSE_SIGNAL_SECRET`（32文字以上のランダム値、例: `openssl rand -base64 48`）がある時だけ、新規解析・上限拒否・希望条件の保存・共有リンク作成を`abuse_signal_events`へ記録する。未設定なら記録しない。保存するのは日次のHMAC（IP・User-Agent）だけで、生の値はDB・ログ・telemetryへ出さない。

- `ABUSE_CLIENT_IP_SOURCE`: 既定`none`（IP signalは常に`null`）。Azure Container Appsのingressが最後の`X-Forwarded-For`に接続元を追記することを実環境で確認できた場合だけ`xff-rightmost`にする。前段に別のproxy（CDNなど）を置いた場合は`none`へ戻す。
- rotation: 新しい秘密値をAzureのsecretに設定してAPIを再起動する。切り替えた日から新しい鍵で計算され、古い鍵のイベントは7日で自然に消える。漏えいが疑われる時は即時に切り替え、必要なら`delete from public.abuse_signal_events`で全削除してよい（7日保持の一時データ）。
- 確認はservice_roleで`select * from public.abuse_signal_overview(now() - interval '1 day')`。仮名そのものはGrafanaのラベルやダッシュボードへ載せない。
