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

rollbackは`supabase/rollback/`に同名のファイルがある。本番で戻すのは、アプリを1つ前のdigestへ戻した**後**に限る（新しいAPIは新しいRPCを前提にするため）。

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

関数の引数型が違って`regprocedure`がエラーになる場合は、`\df public.<関数名>`で実際の型を確認する。

API側の確認:

1. `curl https://api.career.enludus.com/health` → 200
2. Webでログイン→希望条件保存→求人URLを1件分析→`pending`になる
3. 共有リンクを作成→`/s/<token>`が200、失効後に404
4. `select count(*) from public.abuse_signal_events`が増える（`ABUSE_SIGNAL_SECRET`設定時のみ）
