# 本番Supabaseへのmigration適用手順

本番DBの変更は必ず`supabase/migrations/`のファイルで行う。禁止: `db reset --linked`、migration履歴の手動repair、適用済みmigrationの書き換え、migration外のschema変更。

## 1. 適用状況を確認する

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

ローカルのファイル名の先頭（`YYYYMMDDHHMMSS`）と比べ、未適用のものだけを**ファイル名の順に**1件ずつ適用する。以降のmigrationは前のものに依存する（例: 共有リンクはMatch RPC、上限は本人受付RPCが前提）。

適用には`supabase db push`（linked project）を推奨する。Supabase MCPの`apply_migration`は実行時刻でversionを記録することがあり、ローカルのファイル名と履歴がずれる。MCPを使う場合は、名前にファイル名をそのまま付け、適用後に1の結果とファイルの対応をwork logへ記録する。

## 2. 適用対象と注意点（2026年09月30日時点）

| migration | 内容 | 破壊的変更 |
|---|---|---|
| `20260929011641_analysis_history_from_matches` | 分析履歴をMatchから読む | **あり**: `user_saved_jobs`表と`list_saved_jobs_page`をdrop。適用前に`select count(*) from public.user_saved_jobs`を確認し、0件でなければ止めて相談する |
| `20260929022634_request_analysis_singleflight` | 共有job受付 | なし |
| `20260929025040_analysis_job_lease_claim` | lease・SKIP LOCKED | なし（関数内のupdateのみ） |
| `20260929093000_match_result_rpc` | Match保存・読取RPC | なし |
| `20260929131358_analysis_history_page_v2` | 履歴page v2 | なし |
| `20260929133857_personal_analysis_interest` | 本人受付の記録 | なし |
| `20260930010000_resolve_job_evaluation_target` | 評価対象の解決 | なし |
| `20260930015300_secure_rls_auto_enable_execution` | RLS自動有効化関数の実行権限 | なし |
| `20260930020000_issue43_evaluation_provenance` | 評価方法・求人事実 | なし（追加のみ） |
| `20260930050000_issue39_match_shares` | 共有リンク | なし |
| `20260930060000_issue42_analysis_quota` | 新規解析上限 | なし |
| `20260930070000_issue42_jev_budget` | Jev日次予算 | なし |
| `20260930080000_issue42_abuse_signals` | 不正利用signal（7日保持） | なし |
| `20260930120544_service_role_core_privileges` | `service_role`の表権限（下記） | なし（GRANTのみ） |
| `20261001004539_legal_acknowledgement_rpcs` | 法的文書と確認記録のRPC（ADR-046） | なし（関数の追加のみ） |

rollbackは`supabase/rollback/`に同名のファイルがある。本番で戻すのは、アプリを1つ前のdigestへ戻した**後**に限る（新しいAPIは新しいRPCを前提にするため）。

### `service_role_core_privileges`が必要になった理由

2026年09月30日、本番のcrawlerが`permission denied for table source_document_versions`（42501）で失敗した。Supabaseのsecret key（`service_role`）はRLSを迂回するが、表の権限（GRANT）までは持たない。初期の表（`20260927000100`〜）はmigrationで`service_role`へGRANTしておらず、ローカルのテスト用ロール定義が全表を`service_role`へGRANTしていたため、テストで気づけなかった。

修正は、API・crawlerのPostgREST呼び出しと、それらが呼ぶSECURITY INVOKERのRPCを監査して、表・操作ごとに最小限だけGRANTする。`GRANT ALL`、RLS policyの追加、SECURITY DEFINERへの変更はしていない。`anon`/`authenticated`は変更しない。ローカルのロール定義からは全表GRANTを外し、`supabase/tests/service_role_core_privileges.sql`で全表の`service_role`権限を完全一致で検証し、job処理の流れを`service_role`として実行する。

本番の未適用分（`20260930020000`〜`20260930080000`）の後に適用する。crawlerとAPIの機能は、このmigrationまで入って初めて動く。

## 3. 適用後の確認

```sql
-- すべてのpublic表でRLSが有効
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;  -- 0行

-- 主要RPCが存在し、anon/authenticatedから実行できない
select p, has_function_privilege('authenticated', p, 'execute') as client_can_execute
from unnest(array[
  'public.request_personal_analysis_limited(uuid,text,text,text,timestamptz,timestamptz,integer)',
  'public.commit_match_result(uuid,uuid,uuid,text,jsonb,jsonb)',
  'public.reserve_jev_budget(integer,integer)',
  'public.record_abuse_signal(uuid,text,bytea,bytea)'
]::regprocedure[]) p;  -- すべてfalse
```

```sql
-- service_role の表権限（20260930120544 適用後）。すべてtrue
select t, p, has_table_privilege('service_role', 'public.' || t, p)
from (values
  ('source_document_versions', 'SELECT'), ('source_document_versions', 'UPDATE'),
  ('source_urls', 'SELECT'), ('analysis_jobs', 'SELECT'), ('analysis_jobs', 'UPDATE'),
  ('profiles', 'INSERT'), ('profiles', 'UPDATE'),
  ('career_profile_versions', 'INSERT'), ('evaluations', 'INSERT'),
  ('match_results', 'INSERT')
) v(t, p);

-- 不要な権限がないこと。0行
select t, p from (values ('profiles'), ('source_document_versions'),
  ('analysis_jobs'), ('evaluations'), ('match_results')) v(t)
cross join (values ('DELETE'), ('TRUNCATE')) w(p)
where has_table_privilege('service_role', 'public.' || t, p);

-- クライアントが書き込めないこと。0行
select r, c.relname, p from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join (values ('anon'), ('authenticated')) x(r)
cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) y(p)
where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p);
```

表・操作の完全な一覧は`supabase/tests/service_role_core_privileges.sql`の期待値表を正とする。

関数の引数型が違って`regprocedure`がエラーになる場合は、`\df public.<関数名>`で実際の型を確認する。

crawlerの確認: `az containerapp job start -g job-match-prod -n job-match-crawler`を実行し、実行が`Succeeded`になり、ログが`error after 0 jobs`でないこと。

API側の確認:

1. `curl https://api.career.enludus.com/health` → 200
2. Webでログイン→希望条件保存→求人URLを1件分析→`pending`になる
3. 共有リンクを作成→`/s/<token>`が200、失効後に404
4. `select count(*) from public.abuse_signal_events`が増える（`ABUSE_SIGNAL_SECRET`設定時のみ）

## 法的文書の登録（ADR-046、リリース前に必須）

APIの`legal-acknowledgements`は、有効な利用規約とプライバシーポリシーが両方そろうまで503を返し、誰もアプリを利用できない（fail closed）。本文の正は`legal_documents.body_markdown`で、更新・削除はできない（改定は新しい版の追加）。

確定した本文をmigrationとして追加し（例: `supabase migration new legal_documents_v1_0`）、レビューを経て他のmigrationと同じ手順で適用する。本文がrepoにも履歴として残る。

```sql
insert into public.legal_documents
  (document_type, version, body_markdown, published_at, effective_at)
values
  ('terms', '1.0', $terms$…確定した利用規約の本文…$terms$, '2026-10-03 00:00+09', '2026-10-03 00:00+09'),
  ('privacy_policy', '1.0', $pp$…確定したプライバシーポリシーの本文…$pp$, '2026-10-03 00:00+09', '2026-10-03 00:00+09');
```

確認: `curl https://api.career.enludus.com/v1/legal-documents/current`（Web経由では`/api/v1/legal-documents/current`）が200を返し、ログイン後に同意画面が表示されること。改定時は新しい`version`を追加すれば、次回アクセス時に全員へ再確認を求める。
