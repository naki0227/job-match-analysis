# DB論理設計・ER図 v0.1

> このER図は概念的な関係を示す。Issue #14の物理DDL、Issue #15のRLS、Issue #16の原子的RPCは[`supabase/migrations/`](../supabase/migrations/)にある。[総合設計書](design.md)を参照。

## Issue #14の物理DDL

- [基本表・8軸seed](../supabase/migrations/20260927000100_core_schema.sql)と[評価・マッチ表](../supabase/migrations/20260927000200_evaluation_match_schema.sql)を順番に適用する。Supabaseの`auth.users`が前提。実体のPKはUUID、関連表は複合PK。個人所有の子行はユーザー削除に連鎖し、共有行の参照は削除を制限する。
- `career_constraint_locations`は`(profile_version_id, prefecture_code)`、`match_constraint_results`は`(match_result_id, kind)`の複合PK。前者は01〜47の重複を拒否し、後者は必須条件の状態と理由を保持する。
- `career_profile_target_roles`は版ごとの希望職種リストを順序付きで保持する。空白と同一表記の重複を拒否する。職種による自動一致・必須除外はまだ行わない。
- `evaluation_targets`の求人と会社の所属、`evaluation_evidence`の軸評価・使用文書、`match_results`のユーザー・プロフィール版と軸カタログ版は複合FKで確認する。会社名はUNIQUEにしない。URLのUNIQUEは`source_urls.normalized_url`だけに置く。
- `source_document_versions.extracted_text`には抽出本文を保存できる。取得から30日経過した本文は予定済みのworkerがNULLに更新する方針。文書のhash・取得日時と評価の短い根拠抜粋は残す。**worker実装まで自動削除は行われない**ため、本文を保存する運用の開始前に削除処理を接続する。
- 21表すべてでRLSを有効化。Issue #15のmigrationはクライアントの表権限を取り消し、個人10表に認証済み本人のSELECTだけを許す。共有11表と匿名ロールは直接参照・変更できない。
- 手動rollbackは[down SQL](../supabase/rollback/20260927_issue14_down.sql)。全表とデータを削除するため、適用前にバックアップと依存物を確認する。ローカルのup・無効FK/重複/CHECK・RLS・本文削除条件・downの検証は`pnpm test:db`を実行する。

## Issue #38の任意プロフィール・法的文書履歴

[追加migration](../supabase/migrations/20260928161035_optional_profile_education_legal_history.sql)は既存`profiles`にnullable列を加え、学歴と公開文書・本人確認履歴を別表で保持する。学歴と確認履歴は本人のみSELECT可能で、匿名には公開済み文書だけを見せる。認証済みクライアントは書込できない。文書本文と確認履歴はサーバーロールにも更新・削除権限を与えない。[rollback](../supabase/rollback/20260928_issue38_down.sql)は追加データを削除するため、適用前にバックアップする。設計理由は[ADR-022](adr/022-private-profile-education-legal-history.md)を参照。

## データの所有境界

**個人データ:** auth.users → profiles → career_profile_versions → axis_values/constraints、profile_educations、user_legal_acknowledgements、user_saved_jobs、match_results。本人だけが閲覧でき、変更はサーバー処理に限定する。

**共有データ:** companies、job_postings、source_urls、source_document_versions、evaluation_targets、evaluations/evaluated_axis_values/evidence、analysis_jobs。公開企業／求人の情報だけを保存する。共有評価へユーザープロフィールを混ぜない。

**参照データ:** assessment_axes（意味／ルーブリックの版）、legal_documents（公開済み法的文書）、analyzer/evaluator/algorithmの版管理。

## ER図（重要なFK・1対N）

~~~mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : owns
  PROFILES ||--o{ PROFILE_EDUCATIONS : records
  PROFILES ||--o{ USER_LEGAL_ACKNOWLEDGEMENTS : records
  LEGAL_DOCUMENTS ||--o{ USER_LEGAL_ACKNOWLEDGEMENTS : acknowledged
  PROFILES ||--o{ CAREER_PROFILE_VERSIONS : has
  CAREER_PROFILE_VERSIONS ||--o{ CAREER_PROFILE_AXIS_VALUES : contains
  CAREER_PROFILE_VERSIONS ||--o{ CAREER_PROFILE_TARGET_ROLES : targets
  CAREER_PROFILE_VERSIONS ||--o| CAREER_CONSTRAINTS : defines
  CAREER_CONSTRAINTS ||--o{ CAREER_CONSTRAINT_LOCATIONS : allows
  ASSESSMENT_AXES ||--o{ CAREER_PROFILE_AXIS_VALUES : referenced
  COMPANIES ||--o{ JOB_POSTINGS : offers
  COMPANIES ||--o{ EVALUATION_TARGETS : scope
  JOB_POSTINGS o|--o{ EVALUATION_TARGETS : scope
  SOURCE_URLS ||--o{ SOURCE_DOCUMENT_VERSIONS : snapshots
  SOURCE_URLS ||--o{ ANALYSIS_JOBS : deduplicates
  EVALUATION_TARGETS ||--o{ EVALUATIONS : evaluated
  EVALUATIONS ||--o{ EVALUATION_SOURCES : uses
  SOURCE_DOCUMENT_VERSIONS ||--o{ EVALUATION_SOURCES : cited
  EVALUATIONS ||--o{ EVALUATED_AXIS_VALUES : has
  ASSESSMENT_AXES ||--o{ EVALUATED_AXIS_VALUES : referenced
  EVALUATED_AXIS_VALUES ||--o{ EVALUATION_EVIDENCE : supports
  SOURCE_DOCUMENT_VERSIONS ||--o{ EVALUATION_EVIDENCE : quoted
  PROFILES ||--o{ USER_SAVED_JOBS : saves
  JOB_POSTINGS ||--o{ USER_SAVED_JOBS : saved
  PROFILES ||--o{ MATCH_RESULTS : owns
  CAREER_PROFILE_VERSIONS ||--o{ MATCH_RESULTS : snapshot
  EVALUATIONS ||--o{ MATCH_RESULTS : snapshot
  MATCH_RESULTS ||--o{ MATCH_AXIS_RESULTS : details
  MATCH_RESULTS ||--o{ MATCH_CONSTRAINT_RESULTS : checks
  ASSESSMENT_AXES ||--o{ MATCH_AXIS_RESULTS : referenced
  ANALYSIS_JOBS o|--o| EVALUATIONS : completes
~~~

補足: evaluation_targets は「会社全体」または「求人」を表す。求人targetの場合、job_posting.company_idとtarget.company_idの一致を複合FKまたはDB関数で保証する。実際の評価には複数source documentが紐付くのでevaluation_sourcesを中間テーブルとする。

## テーブルと主要キー

| テーブル | PK | 重要な列／UNIQUE／FK |
|---|---|---|
| profiles | id = auth.users.id | 任意の表示名・氏名・連絡先。ログイン用メールはauth.users.email |
| profile_educations | id | user_id FK、複数学歴、self_reported/verified（検証運用は未実装） |
| legal_documents | id | UNIQUE(document_type, version)、本文・公開時刻・適用時刻 |
| user_legal_acknowledgements | id | user_idと文書版のFK、UNIQUE(user_id, legal_document_id, action)、記録時刻 |
| assessment_axes | id | UNIQUE(axis_key, axis_version), 両極の定義・質問・ルーブリック。既存版は不変 |
| career_profile_versions | id | user_id FK、UNIQUE(user_id, version)、draft/completed |
| career_profile_target_roles | (profile_version_id, role_order) | 希望職種の順序付きリスト、版内の同一文字列はUNIQUE |
| career_profile_axis_values | (profile_version_id, axis_key) | preference, importanceの0..100 CHECK、軸カタログ版の複合FK |
| career_constraints | profile_version_id | min_salary（通貨/期間の単位も保持）、remote要件、地域など |
| career_constraint_locations | (profile_version_id, prefecture_code) | 都道府県コード01〜47、重複不可 |
| companies | id | 企業名のみをUNIQUEにしない。外部識別子/公式domain等の照合は別設計 |
| job_postings | id | company_id FK、求人ID/掲載先ID/正規化URL等で重複を検証 |
| source_urls | id | normalized_url UNIQUE、raw_url・canonical aliasの扱いは別 |
| source_document_versions | id | source_url_id FK、content_hash、fetched_at、extractor_version、本文/出典 |
| evaluation_targets | id | target_type company/job、company_id、job_posting_id nullable、整合CHECK + 所属制約 |
| evaluations | id | target_id、source_set_hash、rubric_version、evaluator_version、model_version；この組合せのUNIQUE |
| evaluation_sources | (evaluation_id, source_document_version_id) | 評価入力となった正確な文書版へのFK |
| evaluated_axis_values | (evaluation_id, axis_key) | 0/50/100アンカー、unknown等の状態、軸カタログ版の複合FK |
| evaluation_evidence | id | (evaluation_id, axis_key)と(evaluation_id, source_document_version_id)への複合FK、根拠抜粋・位置 |
| analysis_jobs | id | source_url_id、analyzer_version、status、attempts、lease_until、worker_token |
| user_saved_jobs | (user_id, job_posting_id) | 個人ブックマーク |
| match_results | id | user_id / career_profile_version_id / evaluation_id / algorithm_version |
| match_axis_results | (match_result_id, axis_key) | 当時の希望値・評価値・一致状態と算出理由のsnapshot |
| match_constraint_results | (match_result_id, kind) | 必須条件の状態と理由のsnapshot |

## 制約・Index・権限方針

- URL正規化は fragment・追跡パラメータなど安全なものだけを除去。求人ID等の識別に関わるqueryは残す。DBでは source_urls.normalized_url にUNIQUE。
- 活動中ジョブを原則1つに集約: UNIQUE(source_url_id, analyzer_version) WHERE status IN ('queued', 'running')。完了時の競合にはトランザクション内でfresh評価と活動中jobを再確認する。
- マッチ結果の user_id と career_profile_versions.user_id の一致は **DBでも** 担保する。例えば career_profile_versionsにUNIQUE(id,user_id)、match_resultsに複合FK(profile_version_id,user_id)を使用する。アプリ側認可だけに依存しない。
- evaluation_evidenceは存在する軸評価にだけ紐付ける複合FK、さらに根拠文書がevaluation_sourcesに含まれることをDBで担保する複合FKを検討。
- 軸の版が食い違う値を比較しない。異なる版間は明示的な移行／対応表を設けるか「比較不可」。軸ルーブリック変更は既存行更新ではなく新versionを追加。
- 個人テーブルのSELECTポリシーは auth.uid() と所有者の一致、子テーブルは親へのEXISTSで判定する。クライアントに書込権限は付けない。service-role/secret keyはサーバーのみで保持し、APIでGoogle identityと本人IDを確認する。SECURITY DEFINER関数は追加していない。
- 共有企業データの更新はサーバー権限だけ。外部ページ本文の生データをクライアントに無制限に配布しない。重要な値は出典・取得日を表示。
- FKで関連行を自動削除すると過去評価や他人の保存履歴まで消える可能性があるため、共有側にCASCADEを機械的に使わない。個人データの消去要求には削除経路を用意する。
- N+1を避ける: 保存済み求人はIssue #17のlist_saved_jobs_pageで、本人の保存行・求人・会社・各最新評価を1回のRPCで取得する。保存日時+求人IDのkeyset cursorと最大100件の上限を使い、専用索引をEXPLAINで確認する。[ADR-018](adr/018-saved-jobs-batch-pagination.md)。

## 原子的操作（トランザクション境界）

~~~mermaid
sequenceDiagram
  participant API as API/worker
  participant DB as PostgreSQL
  participant OUT as 外部サイト/Jev
  API->>DB: 単一DB関数: URL upsert / fresh評価 / active job再確認 / claim or join
  DB-->>API: 評価またはjobId
  API->>OUT: fetch / browser / Jev（DB TXの外）
  OUT-->>API: 文書・判断
  API->>DB: 短いTX: 文書版＋評価＋軸＋根拠＋job完了
  DB-->>API: evaluationId
~~~

1. 診断確定: commit_career_profile RPCでプロフィール版 + 希望職種 + 8軸値 + 制約を一度に確定。所有者行ロック・期待版・冪等キーで競合と再送を扱う。
2. 解析受付: fresh評価／活動中job／URL作成を競合に耐えるDB関数で処理。
3. job claim: SKIP LOCKED + status更新 + lease token発行を1操作にする。実行中にDB TXを開きっぱなしにしない。
4. job 完了: commit_analysis_evaluation RPCで正しいworker_tokenを持つrunning jobだけ文書・評価・根拠・完了処理を一度に確定。対象行ロックと評価自然キーで重複を直列化し、内容が同じ場合のみ別jobでも評価を再利用する。完了済みの同じjob/token再送は保存済みIDを返す。
5. 個人Match保存: 結果 + 軸明細を1TXで保存。現プロフィールと古いプロフィール版の混同を防ぐ。

**Supabase JSの複数HTTP呼び出しは単一Transactionではない。** Issue #16の2関数はservice_role専用のSECURITY INVOKER RPCとし、ROLLBACK・同時実行・権限の統合テストで検証する。設計理由は[ADR-017](adr/017-atomic-profile-and-evaluation-commits.md)。

## 公開前に確定すること

RLSポリシー、会社・求人の同一性とURL alias、workerによる30日本文削除、検索とBatchのEXPLAIN、権限昇格テスト、本番backup/restore。[DB関連Epic](https://github.com/naki0227/job-match-analysis/issues/3)の受け入れ条件を起点に確定する。
