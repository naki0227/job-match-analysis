# 障害時の縮退と復旧

Issue #31。本番はWeb（Cloudflare Pages）、API（Azure Container Apps）、crawler（Container Apps Job）、DB・Auth（Supabase Free）、評価（Jev）で動く（ADR-040）。旧計画の「VM消失」は、現在の構成ではContainer App／Jobの停止にあたる。各項目は2026-10-20時点のコードの挙動で、根拠のファイルを示す。

## 共通: まず見るもの

1. `https://career.enludus.com/api/health`（APIのプロセスだけを見る。DBやJevには触れない: `apps/api/src/app.ts`）
2. [Supabase status](https://status.supabase.com)、Azure Portal（Container App・Jobの実行履歴）、Grafana（APIとcrawlerのmetrics・trace、#32）
3. 利用者からの問い合わせ番号（requestId）があれば、APIのログ（`match_unavailable`など）を検索する

## API（Container App）が止まった・起動しない

- **利用者に見えること**: フッターが「API Status: error」（`apps/web/src/App.tsx`）。解析の依頼は「現在、解析を受け付けられません」。Webの静的部分は表示される。
- **縮退**: なし（全機能が止まる）。DBのデータは影響を受けない。
- **復旧**
  1. Azure Portal > Container App > Revisions で、最新revisionの状態とログを確認する。
  2. 直前のデプロイが原因なら、前のimage digestへ戻す（`docs/infrastructure.md`のrollback。`az containerapp update --image <前のdigest>`）。
  3. 0台からの起動には20秒以上かかる（#82）。障害ではない。

## Supabase（DB・Auth）が止まった

- **利用者に見えること**: ログイン状態の確認で失敗する。APIはAuthの確認で`503 auth_unavailable`、DBの読み書きで`503 service_unavailable`／`storage_unavailable`を返す（`apps/api/src/analysis-routes.ts`、`auth/profile-bootstrap.ts`）。`/health`は`ok`のまま（DBを見ないため）。
- **crawler**: 1回の実行（drain）はDBエラーで終了コード1になり、Azureが1回だけ再実行する（`--replica-retry-limit 1`、`docs/runbooks/azure-crawler-job.md`）。それ以上は再試行しない。処理中だったジョブは`running`のまま残り、lease切れの後、次の実行の`claim_analysis_job`で戻される。
- **縮退**: なし。Webは読み込み中・エラーの表示になる。
- **復旧**
  1. Supabaseの障害なら復旧を待つ。復旧後の操作は不要（APIは要求ごとに接続する）。
  2. 残ったジョブを確認する: `select status, count(*) from public.analysis_jobs where updated_at > now() - interval '1 day' group by 1;` `running`が長く残っていれば、crawlerを手動で1回実行する（`az containerapp job start`、`azure-crawler-job.md`）。実行時に`claim`がlease切れのジョブを戻す。
  3. データが消えた・プロジェクトが使えない時だけ、`docs/runbooks/backup-restore.md`の「本番の障害で復元する時」に従う。

## Jevが止まった・遅い・予算を使い切った

- **タイムアウト・429・5xx・ネットワーク**: crawlerは一時的な失敗として扱い、ジョブをすぐ`queued`に戻す。`CRAWLER_MAX_ATTEMPTS`回失敗すると`failed`になる（`apps/crawler/src/job-consumer.ts`、`integrations/jev/decision-engine.ts`）。再試行は待ち時間なしのため、Jevの数秒以上の停止では、その間の依頼はすぐ`failed`になる。
- **利用者に見えること（失敗時）**: 「このページは解析できませんでした」。原因がJevでも、ページの問題のように見える（#85で改善する）。
- **日次予算の使い切り**: ジョブは失敗しない。Jevを呼ばず、ルールで決められる軸（勤務地・勤務時間の柔軟さなど）だけを判定し、残りの軸は「不明」で完了する（`apps/crawler/src/jev-budget.ts`）。本番の予算は`unlimited`。
- **縮退**: 既存の共有評価（cache hit）と保存済みの比較は、Jevと関係なく使える。
- **復旧**
  1. Jev側の状態を確認する。APIキー（`jev-api-key` secret）の失効は、再試行しても直らない（`DecisionEngineProviderError`）。
  2. 復旧後、`failed`になった依頼は、利用者が同じURLをもう一度送れば解析し直される（失敗したジョブは再利用しない）。
  3. 長時間止まる時は、Jevの呼び出しをほぼ止める: APIのContainer Appの`CRAWLER_JEV_DAILY_CANDIDATE_BUDGET`（crawlerの実行に渡す値）を`1`にすると、その日の残りは予算切れと同じ「ルールの軸だけ」の結果で完了する（`0`は設定エラーになる）。`deploy-api.yml`の次のデプロイで`unlimited`に戻るため、復旧後はそのままでよい。長引く時は`deploy-api.yml`も一時的に変える。

## crawler（Container Apps Job）が起動しない・途中で落ちた

- **起動のしかた**: APIは、ジョブを作った時と、ポーリングで`queued`のジョブを見た時だけ、Azureにcrawlerの実行を頼む（クールダウン付き、`apps/api/src/worker-trigger/`）。頼めなくてもHTTPの応答は変わらない（metricsの`workerTrigger`だけに残る）。
- **途中で落ちた時**: ジョブは`running`のままlease（本番600秒）が切れるのを待つ。lease切れのジョブを戻すのは次の`claim`だけのため、**新しい依頼が来るまで回収されない**（#85）。Webは120秒でポーリングをやめ、時間切れを表示する。
- **復旧**
  1. Azure Portal > Container Apps Job > Execution history で失敗の理由を見る。設定エラー（`Crawler worker configuration is invalid`）なら、`azure-crawler-job.md`の設定を直す。
  2. `az containerapp job start`で手動実行し、残ったジョブを処理させる。
  3. 実行が始まっても0件で終わる時は、migrationの未適用（42501）を疑う（`azure-crawler-job.md`）。

## Web（Cloudflare Pages）が止まった

- Cloudflareの障害なら復旧を待つ。直前のデプロイが原因なら、Cloudflare Pagesの管理画面で前のデプロイに戻す（Rollback）。APIとDBは影響を受けない。

## 障害の後

- 発生時刻、影響（失敗したジョブ数、問い合わせ）、原因、直したことをIssueに残す。
- 手順に足りないものがあれば、この文書を更新する。
