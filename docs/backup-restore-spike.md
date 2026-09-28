# #31 バックアップ・別DB復元のローカル検証

## 確認したこと

`sh scripts/test-db-restore.sh` は同じPostgreSQL 17イメージから独立した2コンテナを作る。取得元へ現在のmigrationとダミーデータを適用し、`pg_dump --format=custom` で `auth` と `public` を取得して、別コンテナへ `pg_restore` する。復元先でFK、RLSによる本人以外の遮断、匿名向け公開文書、CareerProfileの2版と子行を確認する。終了時に両コンテナと一時dumpを削除する。DB migration CIでも実行する。

この検証は**実Supabaseプロジェクトのバックアップや復旧を証明しない**。ローカルの `auth.users` は最小fixtureであり、Supabase管理schema、Auth設定、Storage object、外部サービス設定、暗号化鍵の復元は対象外。実データへの接続や本番用dumpファイルの保存は行わない。

## 本番運用の未決事項

RPO/RTOはそれぞれ24時間を目標とするが、現時点で達成済みとは言えない。保存先、暗号化鍵と復号権限、保持期間、日次実行の監視、実Supabase別環境への復元演習を決めてから運用手順を確定する。Supabase公式文書は[Freeプランで定期的なオフサイトexportを推奨](https://supabase.com/docs/guides/platform/backups)し、[CLIによるroles/schema/dataの分割dumpと別プロジェクトへの復元手順](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)を示している。プランやCLIの仕様は運用開始時に再確認する。

VM消失、DB障害、Jev障害の縮退・復旧手順も#31の残作業。特にVM再作成は#34〜#36のインフラ構成、Jev停止中の応答は#22・#23の契約に合わせて検証する。
