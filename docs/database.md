# DB論理設計・ER図 v0.1

> **注意:** これはmigration実行済みの物理DDLではなく、実装前レビュー用の論理設計。各列のNOT NULL・FK・削除方針・所有者チェック・RLSはDB設計Issueで確定する。[総合設計書](design.md)を参照。

## データの所有境界

**個人データ:** auth.users → profiles → career_profile_versions → axis_values/constraints、user_saved_jobs、match_results。本人だけが閲覧・更新できる。

**共有データ:** companies、job_postings、source_urls、source_document_versions、evaluation_targets、evaluations/evaluated_axis_values/evidence、analysis_jobs。公開企業／求人の情報だけを保存する。共有評価へユーザープロフィールを混ぜない。

**参照データ:** assessment_axes（意味／ルーブリックの版）、analyzer/evaluator/algorithmの版管理。

## ER図（重要なFK・1対N）

~~~mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : owns
  PROFILES ||--o{ CAREER_PROFILE_VERSIONS : has
  CAREER_PROFILE_VERSIONS ||--o{ CAREER_PROFILE_AXIS_VALUES : contains
  CAREER_PROFILE_VERSIONS ||--o| CAREER_CONSTRAINTS : defines
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
  ASSESSMENT_AXES ||--o{ MATCH_AXIS_RESULTS : referenced
  ANALYSIS_JOBS o|--o| EVALUATIONS : completes
~~~

補足: evaluation_targets は「会社全体」または「求人」を表す。求人targetの場合、job_posting.company_idとtarget.company_idの一致を複合FKまたはDB関数で保証する。実際の評価には複数source documentが紐付くのでevaluation_sourcesを中間テーブルとする。

## テーブルと主要キー

| テーブル | PK | 重要な列／UNIQUE／FK |
|---|---|---|
| profiles | id = auth.users.id | ユーザー削除時の個人データ削除経路 |
| assessment_axes | id | UNIQUE(axis_key, axis_version), 両極の定義・質問・ルーブリック。既存版は不変 |
| career_profile_versions | id | user_id FK、UNIQUE(user_id, version)、draft/completed |
| career_profile_axis_values | (profile_version_id, axis_id) | preference, importanceの0..100 CHECK |
| career_constraints | profile_version_id | min_salary（通貨/期間の単位も保持）、remote要件、地域など |
| companies | id | 企業名のみをUNIQUEにしない。外部識別子/公式domain等の照合は別設計 |
| job_postings | id | company_id FK、求人ID/掲載先ID/正規化URL等で重複を検証 |
| source_urls | id | normalized_url UNIQUE、raw_url・canonical aliasの扱いは別 |
| source_document_versions | id | source_url_id FK、content_hash、fetched_at、extractor_version、本文/出典 |
| evaluation_targets | id | target_type company/job、company_id、job_posting_id nullable、整合CHECK + 所属制約 |
| evaluations | id | target_id、source_set_hash、rubric_version、evaluator_version、model_version；この組合せのUNIQUE |
| evaluation_sources | (evaluation_id, source_document_version_id) | 評価入力となった正確な文書版へのFK |
| evaluated_axis_values | (evaluation_id, axis_id) | 明示根拠のある評価値、unknown等の状態、確率は別のメタデータ |
| evaluation_evidence | id | (evaluation_id, axis_id)への複合FK、source_document_version_id FK、本文内の根拠位置 |
| analysis_jobs | id | source_url_id、analyzer_version、status、attempts、lease_until、worker_token |
| user_saved_jobs | (user_id, job_posting_id) | 個人ブックマーク |
| match_results | id | user_id / career_profile_version_id / evaluation_id / algorithm_version |
| match_axis_results | (match_result_id, axis_id) | 当時の希望値・評価値・一致状態と算出理由のsnapshot |

## 制約・Index・権限方針

- URL正規化は fragment・追跡パラメータなど安全なものだけを除去。求人ID等の識別に関わるqueryは残す。DBでは source_urls.normalized_url にUNIQUE。
- 活動中ジョブを原則1つに集約: UNIQUE(source_url_id, analyzer_version) WHERE status IN ('queued', 'running')。完了時の競合にはトランザクション内でfresh評価と活動中jobを再確認する。
- マッチ結果の user_id と career_profile_versions.user_id の一致は **DBでも** 担保する。例えば career_profile_versionsにUNIQUE(id,user_id)、match_resultsに複合FK(profile_version_id,user_id)を使用する。アプリ側認可だけに依存しない。
- evaluation_evidenceは存在する軸評価にだけ紐付ける複合FK、さらに根拠文書がevaluation_sourcesに含まれることをDBで担保する複合FKを検討。
- 軸の版が食い違う値を比較しない。異なる版間は明示的な移行／対応表を設けるか「比較不可」。軸ルーブリック変更は既存行更新ではなく新versionを追加。
- 個人テーブルのRLSは auth.uid() と所有者の一致、子テーブルは親へのEXISTSまたは複合所有者FKで判定。service-roleの扱いとSECURITY DEFINER関数は最小限・search_path固定・認可検証を必須にする。
- 共有企業データの更新はサーバー権限だけ。外部ページ本文の生データをクライアントに無制限に配布しない。重要な値は出典・取得日を表示。
- FKで関連行を自動削除すると過去評価や他人の保存履歴まで消える可能性があるため、共有側にCASCADEを機械的に使わない。個人データの消去要求には削除経路を用意する。
- N+1を避ける: 複数求人の最新評価・保存状態は一括JOIN / batch query + cursor pagination。user_id・FKとジョブ状態/leaseの索引をEXPLAINで確認。

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

1. 診断確定: プロフィール版 + 軸値 + 制約を一度に確定。部分入力がcompletedとして見えない。
2. 解析受付: fresh評価／活動中job／URL作成を競合に耐えるDB関数で処理。
3. job claim: SKIP LOCKED + status更新 + lease token発行を1操作にする。実行中にDB TXを開きっぱなしにしない。
4. job 完了: 正しいworker_tokenを持つrunning jobだけ文書・評価・完了処理を一度に確定。リトライによる重複INSERTは一意制約とidempotencyで吸収。
5. 個人Match保存: 結果 + 軸明細を1TXで保存。現プロフィールと古いプロフィール版の混同を防ぐ。

**Supabase JSの複数HTTP呼び出しは単一Transactionではない。** Postgres functionをRPCから呼ぶ等で原子性を作る。実装時はROLLBACK・同時実行・RLSの統合テストを必須とする。

## 公開前に確定すること

全DDL/NOT NULL/FK/ON DELETE/RLS、会社・求人の同一性とURL alias、sourceの保存期間、検索とBatchのEXPLAIN、時刻・通貨・給与期間の単位、権限昇格テスト、migration/rollback/backup。[DB関連Epic](https://github.com/naki0227/job-match-analysis/issues/3)の受け入れ条件を起点に確定する。
