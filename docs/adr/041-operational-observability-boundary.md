# ADR-041: Operational Observability（#32）の計装境界と、無料枠での範囲

## 背景・課題

Issue #32ではAPM・分散トレース・latency/p95・エラー率・job backlog・lease回復・取得失敗・ブラウザfallback・Jevの成否と使用量・新規/staleとcache hit・上限による拒否などをDatadogで観測する。一方、Product / Business Analytics（#41）はGrafanaが担い、両者は代替関係ではない。当面の絶対条件は月額0円。

## 決定（実装済みの範囲）

- domain・applicationは観測ベンダーのSDKへ依存しない。API・crawlerは用途別のport（`ApiMetrics`、`CrawlerMetrics`）へ計測を送り、adapterは`@opentelemetry/api`（Apache-2.0、依存なし）だけを使う。SDK・exporterを登録しない限りno-opで、送信先（Datadog等）はデプロイ側で決める。
- APIはroute template（例: `/v1/public/shares/:token`）・method・status・所要時間を記録し、生のpath・query・token・利用者IDをラベルにしない。解析要求はoutcome（fresh cache hit / stale / queued / quota_rejected / invalid / failed）で数える。
- crawlerはJevの呼び出し回数・候補数・input/output token・予算切れを数える（有限・無制限どちらのJev予算でも計測できる）。
- 計測の失敗や送信先の停止は、`safeApiMetrics`・`safeCrawlerMetrics`で握りつぶし、リクエストやjobを止めない（テスト済み）。
- ログ・トレース・メトリクスのラベルにJWT・token・session・Supabase secret・Jev API key・氏名・メール・電話・CareerProfileの生値・希望値と利用者の組・企業ページ本文・根拠全文・機微なURL query・共有token全文を載せない。

## 送信先の決定（2026年09月30日更新、ユーザー決定）

- Operational Observabilityも**Grafana Cloud Free**で見る。API・crawlerは公式OpenTelemetry SDKとOTLP exporterでGrafana CloudのOTLP endpointへ直接送り、Log Analytics・Azure native logsには依存しない。
- データ経路と責務はProduct / Business Analytics（ADR-043）と分ける。運用はOTel→Grafana Cloudのtelemetry backend（dashboardは`Operations/`）、製品分析はSupabaseの`analytics` schema→読み取り専用role→Grafana PostgreSQL datasource（dashboardは`Product Analytics/`）。
- Grafana固有のSDKはapplication/domainへ入れない。Datadogは今は導入しないが、OTelの送信先を追加するだけで将来併用できる構成を維持する。
- ラベルに生IP・生User-Agent・日次IP/UAのHMAC（ADR-042）を載せない。高カーディナリティでもあり、プライバシー上不要。

### 履歴: Datadogを主系にしていた当初の設計

当初の#32はDatadogをAPM・Trace・Infra・Alertの主系とする設計だった。2026年09月30日に公式ページで確認した**Datadog Free**はInfrastructure Monitoringのみ（5 host・metrics保持1日）で、**APM・分散トレース・Log Managementを含まない**（APMは$31/host/月〜、Logsは$0.10/GB〜）。月額0円の条件では本来の用途を満たせないため、Datadogは将来の追加候補へ移した。

## 見直し条件

Grafana Cloud Freeの上限（metrics 10k active series、logs/traces各50GB/月、保持14日）に近づいた時、予算が付いてDatadogを追加する時。
