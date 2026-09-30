# ADR-041: Operational Observability（#32）の計装境界と、無料枠での範囲

## 背景・課題

Issue #32ではAPM・分散トレース・latency/p95・エラー率・job backlog・lease回復・取得失敗・ブラウザfallback・Jevの成否と使用量・新規/staleとcache hit・上限による拒否などをDatadogで観測する。一方、Product / Business Analytics（#41）はGrafanaが担い、両者は代替関係ではない。当面の絶対条件は月額0円。

## 決定（実装済みの範囲）

- domain・applicationは観測ベンダーのSDKへ依存しない。API・crawlerは用途別のport（`ApiMetrics`、`CrawlerMetrics`）へ計測を送り、adapterは`@opentelemetry/api`（Apache-2.0、依存なし）だけを使う。SDK・exporterを登録しない限りno-opで、送信先（Datadog等）はデプロイ側で決める。
- APIはroute template（例: `/v1/public/shares/:token`）・method・status・所要時間を記録し、生のpath・query・token・利用者IDをラベルにしない。解析要求はoutcome（fresh cache hit / stale / queued / quota_rejected / invalid / failed）で数える。
- crawlerはJevの呼び出し回数・候補数・input/output token・予算切れを数える（有限・無制限どちらのJev予算でも計測できる）。
- 計測の失敗や送信先の停止は、`safeApiMetrics`・`safeCrawlerMetrics`で握りつぶし、リクエストやjobを止めない（テスト済み）。
- ログ・トレース・メトリクスのラベルにJWT・token・session・Supabase secret・Jev API key・氏名・メール・電話・CareerProfileの生値・希望値と利用者の組・企業ページ本文・根拠全文・機微なURL query・共有token全文を載せない。

## Datadogの無料枠（2026年09月30日に公式ページで確認）

Datadog FreeはInfrastructure Monitoringのみで、5 host・metrics保持1日。**APM・分散トレース・Log Managementは含まれない**（APMは$31/host/月〜、Logsは$0.10/GB〜）。したがって#32のうち、APM・分散トレース・p95の長期監視・ログ検索は月額0円では本番利用できない。

## 未決定（DECISION）

- OTel SDK・exporter・Collectorの置き場所。配置（ADR-040）次第で、Workers等のエッジではNode用SDKがそのまま使えない。
- Datadogで有効化する範囲。無料で使えるのはInfrastructureのhost metricsのみで、エッジ配置ではhost自体がない。有料機能は有効化しない。
- IP・User-Agentなどの不正利用signal（#42）の保存先・保持期間・仮名化方法（プライバシー方針のため）。

## 見直し条件

配置の決定時、無料で使えるtrace/metricsの送信先を採用する時、予算が付いた時。Datadogの有料機能でしか満たせない#32の受け入れ条件は、その判断までopenのままにする。
