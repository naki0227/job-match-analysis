# API契約・非同期状態 v0.1

> 一部は実装済み、一部は後続Issueの草案。診断プロフィールの実契約は`packages/contracts/src/career-profile.ts`を参照する。参照: [総合設計書](design.md)、[Architecture](architecture.md)。

## 基本規約

- HTTPS /api/v1 をベースパスの候補とする。初期設計書の /api/* は未version版の記法だったため、具体的な実装Issueで一方に統一する。
- サーバーは必ずJWTを検証し、個人データの所有者をDBレベルでも検証。クライアントから渡されたuserIdを本人性の根拠にしない。
- バリデーションは共有Zod schema。エラーは code / message / requestId で返し、秘密値や内部stackを返さない。
- jobIdは秘匿可能なIDであっても認可の代わりにならない。公開してよいジョブメタデータと本人のMatchを分離する。
- 一覧はcursor + limit。企業・評価はまとめて一括取得し、N+1を回避。

## HTTP endpoint（草案）

| Method | Path | 概要 | 成功 |
|---|---|---|---|
| GET | /api/v1/me | 認証ユーザー | 200 |
| POST | /api/v1/me/profile | Google認証後に本人のprofiles行を冪等に作成。bodyなし、Bearer token必須 | 204 / 400 / 401 / 403 / 503 |
| GET | /api/v1/me/career-profile | 本人の最新確定プロフィール版。Bearer token必須 | 200 / 401 / 403 / 404 / 503 |
| PUT | /api/v1/me/career-profile | 軸ごとのpreference, importanceと必須条件を新バージョンで確定。Bearer token必須 | 200 / 201 / 400 / 401 / 403 / 409 / 503 |
| POST | /api/v1/analyses | 公開求人URLの正規化、共有評価の再利用かジョブ参加 | 200 / 202 |
| GET | /api/v1/analyses/:jobId | 共有jobの公開可能な状態と評価ID（権限は要レビュー） | 200 |
| GET | /api/v1/jobs/:jobPostingId | 個別求人・根拠・取得日・評価版 | 200 |
| POST | /api/v1/matches | 認可済みprofile版と共有evaluation版を比較 | 200 / 201 |
| GET | /api/v1/me/analysis-history | 本人の分析済み求人を最新Match順にページネーション（後続Issueの草案） | 200 |

### 診断プロフィール（Issue #25）

公開経路は`/api/v1/me/career-profile`、Hono内部の経路は`/v1/me/career-profile`。GETにbodyはない。PUTのJSON bodyは`{expectedVersion, idempotencyKey, profile}`。`expectedVersion`は初回0、更新時は表示中の版番号。`idempotencyKey`はUUIDで、同じ内容の再送では同じ値を使う。

`profile`には`axisCatalogVersion: 1`、1件以上の`targetRoles`、8軸それぞれ1件の`axisValues`（`axisKey`、`axisVersion: 1`、`preference`/`importance: 0..100`）、`constraints`（任意の`minSalary: {amount, currency: "JPY", period: "year"}`、`allowedPrefectureCodes: []`、`fullRemoteRequired: boolean`）を含む。空配列の勤務地は条件未指定。未回答の軸があると400で保存しない。

GET 200とPUT 200/201のJSONは`{profileVersionId, profileVersion, profile}`。GET 404は確定版がない場合。PUT 409は別の版が先に確定された場合。エラーは共通の`{code, message, requestId}`で返し、内部DB詳細は含めない。GETは検証済み本人JWT付きpublishable clientを使いRLSで本人行だけを読む。PUTは検証済み本人IDをservice_role専用`commit_career_profile`へ渡す。[ADR-020](adr/020-career-profile-api.md)。

## 共有解析ジョブ状態

~~~mermaid
stateDiagram-v2
  [*] --> queued: 新規URL・fresh評価なし
  queued --> running: workerが原子的claim、tokenとleaseを記録
  running --> completed: token検証→結果・job同一TX確定
  running --> queued: 一時失敗／lease期限切れかつ再試行可能
  running --> failed: 恒久失敗／試行回数上限
  queued --> failed: 無効URLなど登録後の恒久失敗
  completed --> [*]
  failed --> [*]
~~~

APIの1回の POST で外部サイトやJev完了まで待たない。

~~~mermaid
sequenceDiagram
  participant User as Browser
  participant API as Hono
  participant DB as PostgreSQL
  User->>API: POST analyses / URL
  API->>DB: 同一DB操作でcache / active job再確認
  alt fresh共通評価あり
    DB-->>API: evaluationId
    API-->>User: 200 completed + evaluationId + fetchedAt
  else stale共通評価あり
    DB-->>API: 古い評価 + 更新jobId
    API-->>User: 200 stale + evaluationId + refreshJobId
  else 未評価
    DB-->>API: 共有jobId
    API-->>User: 202 queued/running + jobId
    User->>API: GET analyses/:jobId （ポーリング）
    API-->>User: completed + evaluationId / failed
  end
~~~

### キャッシュ・singleflightの定義

- source_urls.normalized_url が同じなら、活動中 job は (source_url_id, analyzer_version) で1つ。URLの等価性は正規化ルールの範囲であり、canonical aliasは別処理。
- 同じjobの複数回処理はあり得る。DBでは同一評価入力・モデル・ルーブリック版のUNIQUE、worker_tokenチェックで重複**確定**を防ぐ。
- staleの求人条件は最新確認が必要と表示。古い情報を確定的な「必須条件一致」と扱わない。
- GET /analyses/:jobId の返答にプロフィール、リクエスト元ユーザーID、別ユーザーのMatchは絶対含めない。

## DecisionEngine port

入力: 公開SourceDocumentの引用可能な抜粋、評価軸ルーブリック、モデル／評価器版。出力: 軸ごとの観測値（またはunknown/conflicting）、確率や生応答のメタデータ、根拠参照ID。JevのScoreがユーザーの0..100と互換だとは**仮定しない**。初期スパイクでAPIの実際のschema・レスポンス・コスト・分布を検証し、変換方法を仕様化する。

Issue #22のworker側ポートは`axisCatalogVersion`、`rubricVersion`、`scope`、軸別の0/50/100アンカー、`id`/`documentIndex`/`locator`付き公開抜粋候補を受け取る。結果は`evaluatorVersion`/実`modelVersion`と各軸の`known`（0/50/100）、`unknown`、`conflicting`、入力候補に存在する根拠IDを返す。候補なし・低確度・`none`は`unknown`。429/timeout等は一時エラーとして再試行し、型外Choiceは提供者エラーとする。Jevには候補の短い本文だけを未信頼データとして渡し、プロフィール・認証情報を含めない。[ADR-028](adr/028-decision-engine-evidence-contract.md)を参照。公開8軸アンカー、文単位の候補生成、再取得時点を含むsource set hash、既存RPCへのpayload変換は[ADR-029](adr/029-public-evidence-selection.md)に記録した。workerからのDB保存と版別再利用、実ページでの較正は接続前である。

## APIセキュリティ・取得制約

- URLは明示的なHTTPS（HTTP許可は別判断）のみ。内部IP・localhost・クラウドメタデータ・redirectとブラウザサブリソースの内部宛接続を阻止。ブラウザのネットワーク名前空間／egress制御が必要。
- Requestにタイムアウト・HTML最大バイト数・redirect数・rate limitを定める。取得先のrobots・利用規約を考慮し、アクセス制限の回避はしない。
- 共有ジョブが成功しても個人の相性計算は別endpointで行い、ユーザーの自由記述を共有評価へ入れない。

## Contract tests

- 同じURLに対する並列POSTが同じjobIdを返す。
- キャッシュfresh時はfetch/Jev無し、stale時は出典日が表示され再解析が最大1ジョブ。
- 認証なし、別ユーザーのprofileId、入力URLに内部アドレス、存在しないjobId、失効JWTをそれぞれテスト。
- 失敗したジョブ・worker lease切れ・429/timeout・重複完了で整合性が壊れない。
