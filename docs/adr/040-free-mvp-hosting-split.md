# ADR-040（提案）: 月額0円MVPの配置と、後続のOCI/k3sとの責務分担

> 状態: **提案（ユーザー判断待ち）**。この文書は実装を決めるものではない。数値は2026年09月30日に各社の公式ページで確認した無料枠。

## 背景・課題

MVP公開時点は月額0円が絶対条件。OCI Ampere A1は大阪で容量不足（Out of capacity）、東京はregion subscription不可のため、OCI/k3s/Argo CDをMVPのrelease blockerにしない。短期の候補はCloudflare FreeとSupabase Free。現行構成はNode上のHono API、Node＋Playwright（Chromium）のcrawler worker、PostgreSQLのjob表、Jev呼び出し、共有ページのOG生成を前提にしている。

## 無料枠の事実（公式）

| サービス | 無料枠 |
|---|---|
| Cloudflare Workers Free | 100,000 requests/日、CPU 10ms/リクエスト、メモリ128MB、subrequest 50/リクエスト、Cron Trigger 5個（1回15分） |
| Cloudflare Browser Rendering（Free） | ブラウザ10分/日、同時3ブラウザ |
| Cloudflare Queues（Free） | 10,000 operations/日 |
| Supabase Free | DB 500MB、egress 5GB、MAU 50,000、Edge Functions 500,000回、自動バックアップなし、1週間無活動で一時停止、有効なproject 2個まで |
| Grafana Cloud Free | metrics 10k active series、logs/traces各50GB/月、保持14日、利用者3人 |
| Datadog Free | Infrastructureのみ5 host・metrics保持1日。APM・分散トレース・Log Managementは含まれない |

## 構成要素ごとの成立性

| 要素 | Cloudflare Free / Supabase Freeで成立するか |
|---|---|
| Web（React静的配信） | 成立。Cloudflare Pages等の静的配信で足りる |
| Hono API | 条件付き。HonoはWorkersで動くが、CPU 10ms/リクエストの上限内に収まるかは実測が必要。Supabase Edge Functions（Deno）でも動かせる |
| Supabase Auth / PostgreSQL / RLS / RPC | 成立（容量・一時停止に注意）。バックアップは#31で別途 |
| 共有jobの受付・状態参照 | 成立（API側のRPC呼び出しのみ） |
| crawler（HTTP取得＋抽出） | 不確実。parse5での抽出はCPU 10msを超えうる。Workersで動かすにはNode依存の書き換えが必要 |
| crawler（Playwright fallback） | 成立しない見込み。Browser Rendering無料枠は10分/日で、ブラウザ操作もPlaywright Node APIとは別実装になる |
| 長時間の解析・Jev呼び出し | Workersは待ち時間は課金外だがCPU上限あり。Cron（15分）かQueues（1万op/日）で駆動する設計変更が必要 |
| OG画像生成（#39） | Workers FreeのCPU 10msでは画像描画は困難。Node上のAPIかSupabase Edge Functionsなら成立しうる |

## 選択肢（crawler workerの置き場所が主な論点）

- **A: API・Webは無料のエッジ、crawlerは手元／CIの定期実行**。Web＝Cloudflare静的配信、API＝Workers（または Supabase Edge Functions）、DB＝Supabase。crawlerはGitHub Actionsのscheduled workflow（公開repoなら無料、privateは月2,000分）か開発者の手元で定期実行。解析の完了まで数分〜十数分の遅延が出る。
- **B: すべてエッジへ寄せる**。crawlerをWorkers＋Queues＋Browser Renderingへ書き換える。無料枠（ブラウザ10分/日、CPU 10ms）に収まる保証がなく、改修も大きい。
- **C: OCI A1の確保まで公開を待つ**。0円は保てるが公開時期が容量次第になる（ユーザー方針に反する）。

**推奨: A**。既存のNode crawler（HTTP→Playwright、lease、Jev予算）をそのまま使える。解析の遅延はUI上「順番待ち」で表現済み。APIの実行場所（Workers／Supabase Edge Functions）は、CPU上限の実測とOG生成の置き場所（#39）と合わせて決める。

## 後続（OCI/k3s）との責務差分

| 責務 | Immediate Free MVP（案A） | Later OCI/k3s |
|---|---|---|
| Web配信 | Cloudflare静的配信 | k3s上のnginx＋Cloudflare Tunnel |
| API | Workers または Supabase Edge Functions | k3s上のNode（Hono） |
| crawler worker | GitHub Actions定期実行 または 手元 | k3s上の常駐worker（NetworkPolicyでegress制限、#36） |
| 観測 | OTel計装のみ（exporterは無料範囲だけ） | OTel Collector→Datadog／Grafana |
| GitOps | GitHub Actionsのdeploy | Argo CD（#35） |

## 未決定（Decision Gate）

API実行基盤、crawlerの実行方式、OG生成の場所、ネットワーク層のegress制御（#36の代替）。決定後に本ADRを「決定」に更新し、`docs/infrastructure.md`を同期する。
