# API契約・非同期状態 v0.1

> 実際のZod schema、認証middleware、HTTPレスポンス型、Jev SDKの契約はIssueで検証してから実装する。記載のJSONは概念例であり本番API実装済みではない。参照: [総合設計書](design.md)、[Architecture](architecture.md)。

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
| GET | /api/v1/me/career-profile | 最新の確定プロフィール版 | 200 / 404 |
| PUT | /api/v1/me/career-profile | 軸ごとのpreference, importanceと必須条件を新バージョンで確定 | 200 / 201 |
| POST | /api/v1/analyses | 公開求人URLの正規化、共有評価の再利用かジョブ参加 | 200 / 202 |
| GET | /api/v1/analyses/:jobId | 共有jobの公開可能な状態と評価ID（権限は要レビュー） | 200 |
| GET | /api/v1/jobs/:jobPostingId | 個別求人・根拠・取得日・評価版 | 200 |
| POST | /api/v1/matches | 認可済みprofile版と共有evaluation版を比較 | 200 / 201 |
| GET | /api/v1/me/saved-jobs | ブックマークのページネーション＋batch評価表示 | 200 |

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

## APIセキュリティ・取得制約

- URLは明示的なHTTPS（HTTP許可は別判断）のみ。内部IP・localhost・クラウドメタデータ・redirectとブラウザサブリソースの内部宛接続を阻止。ブラウザのネットワーク名前空間／egress制御が必要。
- Requestにタイムアウト・HTML最大バイト数・redirect数・rate limitを定める。取得先のrobots・利用規約を考慮し、アクセス制限の回避はしない。
- 共有ジョブが成功しても個人の相性計算は別endpointで行い、ユーザーの自由記述を共有評価へ入れない。

## Contract tests

- 同じURLに対する並列POSTが同じjobIdを返す。
- キャッシュfresh時はfetch/Jev無し、stale時は出典日が表示され再解析が最大1ジョブ。
- 認証なし、別ユーザーのprofileId、入力URLに内部アドレス、存在しないjobId、失効JWTをそれぞれテスト。
- 失敗したジョブ・worker lease切れ・429/timeout・重複完了で整合性が壊れない。
