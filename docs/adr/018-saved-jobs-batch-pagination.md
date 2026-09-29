# ADR-018: 保存済み求人の一括取得とカーソルページング

状態: [ADR-023](023-analysis-history-from-matches.md)で置換。以下はIssue #17当時の判断記録。

## 背景と課題

Issue #17は保存済み求人の一覧で、求人ごとに会社と最新の共有評価を個別取得しないことを求める。既存の主キーは保存日時順の走査には向かず、件数に比例するDB往復を避ける取得境界が必要だった。

## 選択肢

- APIから複数の一括問い合わせを組み合わせる: findByIdsとfindLatestByTargetIdsを独立させやすいが、複数往復とその間の評価更新を扱う必要がある。
- PostgreSQLの1つの一覧RPCでページ・求人・会社・最新評価を結合する: 往復が1回で同じ文のsnapshotを使えるが、一覧固有のSQLが増える。
- 1件ごとの問い合わせ: 単純だがN+1になり、100件で遅延が増える。

## 決定

既存のSupabase接続から、service_role専用のSECURITY INVOKER関数 list_saved_jobs_page を呼ぶ。1ページは最大100件で、DBはlimit+1件を返し、repositoryが次ページの有無とカーソルを作る。カーソルは保存日時と求人IDの組で、同時刻の保存にも全順序を付ける。user_saved_jobsに(user_id, created_at DESC, job_posting_id DESC)索引を追加する。

SQL内でページに含まれる求人・会社をJOINし、それぞれの最新評価を既存のtarget索引と評価日時索引で探す。これはfindByIdsとfindLatestByTargetIdsに相当する一括取得契約で、1件・20件・100件のどのページでもアプリからのDB RPCは1回。評価がない対象はNULLのまま返す。抽出本文や根拠など一覧に不要な列は取得しない。

repositoryは入力・DB応答を検証し、DBエラー詳細を呼び出し元に漏らさない。本人IDは後続のHTTP handlerが検証済みJWTから渡す。今回のIssueでは新しいHTTP endpointを公開しない。

## メリット・デメリット

1回のDB往復でページ内容の整合したsnapshotを得られ、keysetで深いページのOFFSET走査を避けられる。一覧SQLは画面の表示要件に結びつき、列の追加時にRPCとrepositoryを合わせて変更する必要がある。ページ内の各対象への索引探索は発生するため、対象数が大きくなったらEXPLAINと実測で再評価する。

## 見直し条件

同一対象の評価数が増えて最新評価索引探索が高コストになった場合、一覧の条件・並び順が増えた場合、またはページサイズ上限を変える場合に見直す。HTTP公開時にはカーソルの外部表現と認可テストを別途定める。
