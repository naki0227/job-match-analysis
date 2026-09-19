# Infrastructure / GitOps / 運用設計 v0.1

> この構成は「小規模サービスを安価に提供する」と「Kubernetes/GitOpsを自分で設計・運用する」の二つの目的を持つ。Kubernetesはサービスの規模から必須というわけではない。費用・リソース・サービスの実行可能性は未検証。参照: [総合設計書](design.md)、[Architecture](architecture.md)。

## 本番想定・ネットワーク境界

~~~mermaid
flowchart TB
  users["利用者 Browser"] --> edge["Cloudflare Free: DNS / TLS edge / access policy"]
  operator["開発者"] --> access["Cloudflare Access: 管理者認証"]
  access --> edge
  edge --> tunnel["cloudflared: outbound Tunnel"]
  subgraph OCI["OCI Always Free VM（仮・単一障害点）"]
    subgraph K3S["k3s / ARM64 / single node"]
      tunnel --> web["web: React static assets + Hono API"]
      tunnel --> argo["Argo CD UI / API（Accessで保護）"]
      web --> jobs["PostgreSQL-backed analysis job"]
      crawler["crawler worker: HTTP + Playwright"] --> jobs
      otel["logs/traces exporter"] -. "アプリ・workerのテレメトリ" .-> web
      otel -.-> crawler
    end
  end
  web <-->|"TLS"| supa[("Supabase Auth / PostgreSQL")]
  crawler <-->|"TLS"| supa
  crawler -->|"安全なegress"| sites["企業の公開採用ページ"]
  crawler -->|"公開文書のみ"| jev["Jev API"]
  otel --> grafana["Grafana Cloud Free（上限あり）"]
  note["管理アクセス: argocd-career.enludus.com"] -.-> argo
  domain["career.enludus.com"] -.-> web
~~~

実際のルーティングはサービスごとのTunnel ingress rulesで指定する。外部からVMへの新規着信ポート開放は原則不要。**Cloudflare Accessに加え、Argo CD自体の認証・RBACも無効化しない。** tunnelから管理サービスへ到達するルート以外が露出していないか確認する。Supabase/Jevは外部SaaSであり、VM内の構成ではない。

### 環境とデプロイ先

| 環境 | 実行基盤 | 用途 |
|---|---|---|
| local | Docker Compose + 必要ならk3d | 単体・DB統合・Fixture E2E。外部Jevは原則fake |
| preview/staging | ローカルk3d等から開始（OCIの容量を見て判断） | マイグレーション・GitOps切替・回帰テスト |
| production（後続） | OCI Always Free 1台 + k3s | 非HAであることを了承した公開環境 |

OCI Ampere A1の無料割当・在庫・ARM64 Playwrightブラウザ・Egress/ストレージの条件を実地確認するまでVMリソース値を保証しない。Crawlerはブラウザ同時起動を1件から開始し、CPU/メモリの要求量・limitを測る。VM 1台ではPodのreplica数を増やしてもノード冗長性は得られない。

## GitOpsのパス

~~~mermaid
flowchart LR
  dev["開発者: 手書きコード + PR"] --> apprepo["app repository"]
  apprepo --> ci["GitHub Actions: lint / type / tests / image scan"]
  ci -->|"main merge成功"| ghcr["GHCR: linux/arm64 image + immutable digest"]
  ghcr --> update["GitOps更新PR: digest差替"]
  update --> gitops["GitOps宣言: Kustomize/Helm values"]
  gitops --> argo["Argo CD: Gitとclusterを同期"]
  argo --> k3s["k3s Deployments / Services"]
  k3s -. "health / smoke / rollback判断" .-> dev
  tf["Terraform: OCI / ネットワーク / Cloudflare等"] --> infra["クラスタを動かす土台"]
  infra --> k3s
~~~

- CIはアプリをビルド・テスト・イメージ公開するが、GitHub Actionsから直接 kubectl apply しない。
- mainの変更からGitOps PRでdigest更新し、レビュー後Argo CDが宣言状態へsync。tag名だけを信頼せずdigest固定にする。
- Terraform: OCI VM/VCN/NSG、必要なCloudflare DNS/Tunnel等の**クラスタ外リソース**。Terraform stateには機密値が混ざり得るため暗号化された限定アクセスの保存先を先に設計。
- Argo CD: アプリDeployment、Service、Ingress/Tunnel側のKubernetes設定、ConfigMap、Pod resource制約、worker等。TerraformとArgoが同じKubernetes objectを二重管理しない。
- Bootstrap: VMにk3sを用意し、Argo CD初期導入→GitOps repositoryへ制御を移す手順をrunbook化。管理用トークンや生SecretをGitに格納しない。
- rollback: GitOps宣言の直前の既知の良いimage digestへ戻す。DB migrationに破壊的変更がある場合は単純なイメージrollbackができないためexpand → migrate → contractを採用。

## ストレージ・可用性・バックアップ

- 永続的なユーザーデータとジョブはSupabase PostgreSQLに置く。OCI VMのローカルディスクが失われてもDBを再作成しない。
- ジョブはlease_until・worker_token・attemptsでworker障害時に回収。DB障害中の再試行は無限ループにしない。
- 単一VM障害、OCIアカウント制限、無料枠の仕様変更ではサービス停止があり得る。保証された99.9% SLAのように表示しない。
- RPO 24時間 / RTO 24時間は **目標**。Freeプランの機能だけで実現済みとみなさず、バックアップの保管先・暗号化・保持期間・復元演習を別Issueで確定。
- 解析済みの公開データは再取得可能なものもあるが、求人終了やページ削除により再現できない場合がある。版・出典を残す。

## Secret管理

JEV_API_KEY、Supabaseサーバー権限キー、DB接続情報、Cloudflare Tunnel credential、Grafana送信credential、GHCR pull用資格情報をGit/ログ/イメージに含めない。clientで使う公開可能なSupabaseキーとserver-onlyの秘密鍵は分離。初期は最小権限のKubernetes Secretを安全な手順で注入し、GitOpsで暗号化管理をするならSOPS等の導入を別ADRで判断。特定の外部Secret Managerを無料だと仮定して必須依存にしない。

## Observability

~~~mermaid
flowchart LR
  api["API structured JSON + requestId"] --> collect["OTel / export pipeline"]
  crawler["Worker logs + jobId + latency"] --> collect
  k3s["k3s Pod / resource metrics"] --> collect
  collect --> gc["Grafana Cloud: logs / traces / metrics"]
  ci["Autocannon local + future k6"] -. "性能指標（本番Jevへ大量負荷を流さない）" .-> gc
~~~

監視対象はAPI p95、error rate、DB接続失敗、ジョブ滞留・lease失効、Crawler browser fallback率とメモリ、Jev失敗率・入力トークン概算、キャッシュヒット率、GitOps Sync/health。ログに個人の自由記述・JWT・URLの機密query・生の企業本文・Jevリクエスト全文を載せない。

## 公開前のインフラ受け入れ条件

- 無料枠・課金通知・有料化を防ぐ利用上限が確認できる。
- linux/arm64のweb/worker imageがGHCRからpullでき、Playwright browserがVMの割当内で起動できる。
- AccessなしでArgo CD UI/APIへ到達できない。originの直叩きもできない。
- 停止したworkerのjobがlease期限後に回収され、結果の二重確定が起きない。
- Terraformから土台、GitOpsからワークロードを再作成できる。DBバックアップからの復元手順も検証済み。
