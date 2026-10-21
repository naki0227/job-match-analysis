# 本番DBのバックアップと復元

Issue #31。Supabase Freeには、利用者が復元に使えるバックアップがない（[Supabaseの説明](https://supabase.com/docs/guides/platform/backups)）。そのため、毎日の暗号化したexportを唯一のバックアップとして扱う。

## 方針

| 項目 | 決定 |
|---|---|
| 対象 | 本番Supabaseの全DB（`supabase db dump`のroles・schema・data）。Auth利用者、プロフィール・希望条件・Match・分析依頼などの**個人データ**と、共有評価・求人・取得文書のメタデータを含む |
| 頻度・RPO | 毎日1回、03:17 JST（`.github/workflows/db-backup.yml`）。最大24時間分のデータを失い得る |
| RTO | 24時間以内（新しいSupabaseプロジェクトへの復元とAPI・crawlerの接続先の切り替え） |
| 保存先 | GitHub Actionsのartifact（このrepository）。**リポジトリは公開**のため、artifactは暗号化済みのものだけを置く |
| 暗号化 | [age](https://age-encryption.org/)の公開鍵暗号（X25519）。workflowは公開鍵（`BACKUP_AGE_RECIPIENT`）だけを持ち、**復号できない**。復号用の秘密鍵は持ち主がオフラインで保管し、repository・CI・クラウドには置かない |
| 改ざん検出 | 暗号化前の各ファイルのSHA-256（`SHA256SUMS`）を一緒に暗号化し、復元時に確認する |
| 保持期間 | 30日（artifactの保持期限）。古いものは自動で消える |
| アクセス権 | DB接続文字列（`SUPABASE_DB_URL`）はGitHubの`production-backup` environmentのsecret。artifactの暗号文はrepositoryを読める人が取得できるが、秘密鍵なしでは読めない。復元できるのは秘密鍵を持つ持ち主だけ |
| 退会との関係 | 退会した人のデータも、最長30日間はバックアップに残る（バックアップから個別には消さない）。復元する時は、復元時点より後の退会を再適用する（下記） |
| 失敗の検知 | workflowが失敗するとGitHubから持ち主に通知される。設定がない時も失敗させ、バックアップが取れていないことを隠さない |

## 初回の設定（持ち主が行う）

1. 秘密鍵を作り、オフラインで保管する（パスワード管理ツールなど）。

   ```sh
   age-keygen -o job-match-backup-key.txt   # 表示される公開鍵（age1...）を控える
   ```

2. GitHubのrepository設定 > Environments に`production-backup`を作る。
   - Variable `BACKUP_AGE_RECIPIENT` = 1の公開鍵（`age1...`）
   - Secret `SUPABASE_DB_URL` = SupabaseのDB接続文字列（Session pooler、`postgresql://postgres.<ref>:<password>@...:5432/postgres`）
3. Actions > DB backup > Run workflow で1回実行し、artifactができることを確認する。

## 復元の演習（四半期に1回、または初回設定の後）

本番とは別の、**空の**Supabaseプロジェクトに復元して確かめる。本番のプロジェクトへは絶対に復元しない。

1. 演習用のSupabaseプロジェクトを作る（Freeの2プロジェクト枠を使う。演習後に削除する）。
2. 最新のartifact（`job-match-db-<日時>.tar.age`）をActionsからダウンロードする。
3. 復元する。

   ```sh
   BACKUP_AGE_IDENTITY_FILE=job-match-backup-key.txt \
   RESTORE_DB_URL='postgresql://postgres.<演習用ref>:<password>@...:5432/postgres' \
     sh scripts/backup/restore-backup.sh job-match-db-<日時>.tar.age
   ```

4. 確認する（SQL Editor）。
   - 件数: `select count(*) from auth.users`、`public.career_profile_versions`、`public.match_results`、`public.evaluations`がバックアップ時点と近いこと
   - migration履歴: `select max(version) from supabase_migrations.schema_migrations`がmainの最新migrationと一致すること
   - RLS: 全表で有効（`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`が0行）
5. 結果（日時、artifact名、件数、かかった時間）を#31（または演習のIssue）に記録し、演習用プロジェクトを削除する。

形式そのもの（dump→暗号化→復号→復元→FK・RLS・版履歴の確認）は、`scripts/test-db-backup-encryption.sh`がダミーデータで毎回CIで確かめる。

## 本番の障害で復元する時

1. 原因を確認し、Supabaseの障害なら[status.supabase.com](https://status.supabase.com)の復旧を待つほうが早いか判断する（データ消失・プロジェクト削除の時だけ復元する）。
2. 新しいSupabaseプロジェクトを作り、「復元の演習」の2〜4で最新のバックアップを復元する。
3. **バックアップの時点より後に退会した人のデータを消す**。退会はAuth userの削除で行うため、Supabaseの監査ログ（Auth logs）で該当期間の`user_deleted`を確認し、同じ`id`を`auth.users`から削除する（CASCADEで個人データが消える）。
4. Auth設定（Googleログイン、Redirect URL）を新しいプロジェクトに設定し直す。Auth設定はDBのdumpに含まれない。
5. 接続先を切り替える: APIのContainer App（`SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`SUPABASE_PUBLISHABLE_KEY`）、crawlerのJob（secretの`supabase-secret-key`）、Web（`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`、再build）。
6. `docs/runbooks/production-migrations.md`の1で、migration履歴がmainと一致することを確認する。
7. 失ったデータ（最大24時間分）を利用者に告知する。

## 未決事項

- artifactの保存先を、公開repositoryの外（Azure Blob、Cloudflare R2など）へ移すか。暗号化しているため必須ではないが、暗号文も外に置かないほうがよい。費用と鍵管理の手間で判断する。
