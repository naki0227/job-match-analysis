# ADR-030: 共有解析のHTTP受付とジョブ状態

## 背景・課題

Issue #23ではAPIが外部サイトやJevを同期待ちせず、既存の原子的`request_analysis` RPCをHTTPへ公開する。ジョブは複数ユーザーで共有される一方、プロフィールとMatchは個人情報である。URL正規化、認証、200/202とポーリングの契約を固定する必要がある。

## 選択肢

1. jobIdを知る人なら匿名で状態を読める。実装は容易だが、状態を第三者へ渡しやすい。
2. Google認証済みユーザーだけが共有ジョブの状態・評価IDを読める。共有ジョブを保ちつつ個人情報を出さないが、全ジョブの状態を認証ユーザーが読める。
3. ジョブ要求者だけに読ませる。閲覧範囲は狭いが、要求者と共有ジョブの対応表・RLS・履歴管理が必要。

## 決定と理由

2を採用する。POSTとGETは既存のGoogle identity検証を通す。POST bodyは公開HTTPS URLだけとし、本人IDやプロフィールを受け取らない。URL受付時に明らかな内部宛・IP直指定・認証情報・非標準ポートを拒否し、fragmentと既知の`utm_*`追跡パラメータだけを除く。求人識別に関係するqueryは保持する。これは受付時の確認であり、CrawlerはDNS全回答・接続先固定・redirectを改めて検査する。

`request_analysis`の`fresh`は200 `completed`と評価ID・取得日時、`stale`は200 `stale`と旧評価ID・取得日時・更新jobId、未評価は202 `pending`と共有jobIdを返す。`pending`はPOST時点でqueuedまたはrunningのいずれも表し、GETは実際のqueued/running/completed/failedを返す。GETはジョブ状態と評価IDだけを取得し、userId、プロフィール、Match、worker token、内部エラーを返さない。存在しないjobIdは404。レスポンスは共有Zod契約に従う。

解析版と鮮度期間は`ANALYZER_VERSION`・`ANALYSIS_FRESHNESS_SECONDS`の必須実行設定にし、費用・運用上の数値をコードに固定しない。設定が欠けるとPOSTは503を返す。GETには設定を要求しない。

## メリット・デメリット・見直し条件

DBのsingleflightと共有評価をAPIでも利用し、ユーザー固有情報をジョブ状態から分離できる。認証ユーザーは知っているjobIdの共有状態を読めるため、ジョブに非公開内容を載せない。サイト別利用条件・リクエスト量制限・Worker設定は別途運用判断が必要。ジョブを本人限定にする要件が出た場合は要求者対応表とRLSを設計する。
