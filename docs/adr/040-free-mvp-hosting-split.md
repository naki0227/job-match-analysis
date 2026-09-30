# ADR-040: 月額0円MVPの配置と、後続のOCI/k3sとの責務分担

> 状態: **決定（2026年09月30日、ユーザー決定）**。当初はCloudflare Workers中心の案を提案したが、Azure for Students / Azure Container Appsの実動確認を経て、下記の配置に決めた。無料枠の数値は同日に各社の公式ページで確認した。

## 背景・課題

MVP公開時点は**定常運用の月額実費0円**が絶対条件。OCI Ampere A1は大阪で容量不足（Out of capacity）、東京はregion subscription不可のため、OCI/k3s/Argo CDはMVPのrelease blockerにしない。既存の構成はNode上のHono API、Node＋Playwright（Chromium）のcrawler worker、PostgreSQLのjob表（lease・worker token・SKIP LOCKED）、Jev呼び出し、共有ページのOG生成を前提にしている。Cloudflare Workers Freeは1リクエストあたりCPU 10ms、Browser Renderingは1日10分で、PlaywrightのcrawlerやOG描画には合わない。

## 決定: MVPの実行基盤

| 責務 | 実行基盤 |
|---|---|
| Web（React/Vite SPA） | Cloudflare Pages Free |
| API（Hono、共有ページのHTML・OG画像を含む） | Azure Container Apps（Consumption）`job-match-api` |
| crawler worker（HTTP取得・決定的parser・rule・Playwright fallback・Jev） | Azure Container Apps Job（Consumption、手動起動） |
| Auth・PostgreSQL | Supabase Free |
| コンテナイメージ | GHCR（API・crawler） |
| 観測（運用）と製品分析のUI | Grafana Cloud Free（データ経路と責務は分ける。ADR-041、ADR-043） |

- **API**: Consumption、0.25 vCPU / 0.5 GiB、min replicas 0（scale to zero）、max 1、外部ingress、GHCRのimage、Log Analyticsなし。実測で不足した時だけ増やす。Azure creditを理由に増やさない。
- **crawler**: Container Apps Job、手動（on-demand）起動、parallelism 1、実行1件、ブラウザ同時1、初期値1 vCPU / 2 GiB、処理が尽きたら終了して常駐しない。Playwrightの実測後に下げられるなら下げる。
- **jobの正本はPostgreSQL**（`analysis_jobs`・`lease_until`・`worker_token`・`attempts`・`SKIP LOCKED`）。Azure Jobは「workerプロセスを起動する実行契機」でしかなく、job状態をAzureへ移さない。
- **起動方法**: APIが新しい共有jobを作った時（既存jobへの参加やcache hitでは起動しない）、APIのsystem-assigned managed identityでARMの`POST .../Microsoft.App/jobs/{job}/start`を呼ぶ。adapterはinfrastructure層に置き、domain/applicationはAzureに依存しない。Azure SDKは追加せず、Container Appsのidentity endpoint（`IDENTITY_ENDPOINT`・`X-IDENTITY-HEADER`）からtokenを得る。Web clientへAzureの資格情報を渡さない。
- **RBAC**: APIのidentityに付ける権限は、crawler Jobリソースをscopeにした`Microsoft.App/jobs/start/action`だけのcustom roleとする（built-inのContributorは過剰）。

## 月額0円の運用条件

Azure Container Apps Consumptionの無料枠は、**subscriptionごとに毎月180,000 vCPU秒・360,000 GiB秒・200万リクエスト**。Jobもresource消費（active rate）として同じ無料枠を使い、リクエスト課金はない。目安として、1 vCPU / 2 GiBのcrawler Jobは月約50時間、0.25 vCPU / 0.5 GiBのAPIは稼働中のみ消費する。Azure for Studentsの$100 creditは定常運用費ではなく、事故・一時的なspike・試験の余裕として扱う。

**追加しない有料リソース**（必要ならDecision Gate）: Azure Container Registry、Log Analyticsのingestion、Dedicated workload profile、NAT Gateway、Private Endpoint、有料のQueue/Service Bus、有料のブラウザサービス、その他の有料addon。

**無料枠の監視**: Azure Portalの「コストの管理」でsubscriptionの予算アラートを$0超過で設定し、Container Appsの使用量（vCPU秒・GiB秒）を月ごとに確認する。無料枠の70%に近づいたら、crawler Jobの実行回数・resource・API replicaを見直す。確認手順は`docs/infrastructure.md`に記載する。

## 後続（OCI/k3s）との責務差分

| 責務 | MVP（Azure/Cloudflare/Supabase） | Later OCI A1 + k3s + Argo CD |
|---|---|---|
| Web | Cloudflare Pages | k3s上のnginx＋Cloudflare Tunnel |
| API | Azure Container Apps | k3s上のNode（Hono） |
| crawler | Azure Container Apps Job（APIが起動） | k3s上の常駐worker（NetworkPolicyでegress制限、#36） |
| image | GHCR（linux/amd64、可能ならarm64も） | GHCR（linux/arm64） |
| 観測 | OTel SDK→Grafana Cloud | OTel Collector→Grafana Cloud（Datadogは将来追加可） |
| デプロイ | GitHub Actions＋image digest | Argo CD（#35） |

OCI構成は削除せず、将来のGitOps/Kubernetes学習・移行先として残す。

## メリット・デメリット

既存のNode API・Playwright crawler・PostgreSQLのjob管理をそのまま使え、月額0円を保てる。一方、APIはscale to zeroのため初回応答が遅く、crawlerはJob起動の待ち時間がある（UIは「順番待ち」で表現済み）。ネットワーク層のegress制御（#36）はAzureの無料構成では限定的で、アプリ側の取得境界（ADR-021）に依存する。

## 見直し条件

無料枠の70%に近づいた時、OCI A1の容量が確保できた時、Playwrightの実測でresourceを変える時、有料化の判断が出た時。
