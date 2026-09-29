# ADR-027: Jev通信をCrawlerのDecisionEngine境界に置く

## 背景・課題

Issue #22の評価は、#20でclaimしたworkerが#21の公開文書を取得してから行う。#8で検証したJev HTTPクライアントは`apps/api`にあったが、本番コードからの呼び出しはなく、APIリクエスト中に外部評価を待たないという既存仕様とも合わない。

## 選択肢

1. APIがJevを呼び、CrawlerからAPIへ評価を依頼する。既存ファイルを動かさずに済むが、内部HTTP契約と認証を増やす。
2. JevクライアントをCrawlerへ移し、worker内のDecisionEngineポートから呼ぶ。外部通信とlease処理を同じ実行単位にできる。
3. Jevクライアントを共有packageへ移す。複数プロセスで使えるが、現時点の利用者はCrawlerだけで管理対象を増やす。

## 決定と理由

2を採用する。既存のHTTP/Zod契約とエラー型は維持し、クライアントとテストをCrawlerへ移す。APIは受付と本人向け結果参照を担当し、Jevキーを必要としない。ADR-009の「APIサーバーから呼ぶ」という配置だけを本ADRで置換し、実APIで検証したNoul/Choice/Scoreの契約は引き継ぐ。

## メリット・デメリット・見直し条件

workerのretry/leaseと外部評価失敗を一箇所で扱える。一方、CrawlerにJevキーが必要であり、Secret注入と費用上限はインフラ設計で扱う。別の実行者がJevクライアントを必要とする場合は共有packageへの移動を検討する。評価ルーブリックとunknown/evidenceへの変換は本ADRでは定めず、Issue #22の後続実装とテストで定義する。
