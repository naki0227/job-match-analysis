# アプリケーションアーキテクチャ v0.1

> [総合設計書](design.md)を具体化した論理構成案。サービス運用のための最小構成と、GitOpsを学ぶための構成を分離する。コード実装は未着手。

## 目的・境界

- ログインユーザーの自己申告の仕事観・希望条件を保存し、公開企業／求人資料との一致・相違・不明を根拠付きで返す。採用可否・能力・心理学的な適性を断定しない。
- 企業・求人の取得／共有評価はユーザー非依存。個人プロフィールを共有キャッシュに混入しない。
- HTTP層はHono、ドメインは外部SDKを知らないTypeScriptの純粋ロジック。外部I/OはApplication層のport越し。
- 企業と個別求人は別の集約。会社文化を求人の個別条件（報酬・勤務地等）に上書きしない。

## C4風コンテキスト図

~~~mermaid
flowchart LR
  person["利用者"]
  web["React + Vite SPA"]
  cf["Cloudflare DNS / edge + Tunnel"]
  api["Hono API"]
  db[("Supabase Auth / PostgreSQL")]
  worker["共有解析worker"]
  public["企業・採用サイト（公開範囲）"]
  jev["Jev API（外部判断モデル）"]
  person --> web --> cf --> api
  api <-->|"認証・プロフィール・ジョブ・共通評価"| db
  api -->|"解析要求の登録"| db
  worker <-->|"lease取得・結果の短いTX"| db
  worker -->|"安全なURL取得・必要時ブラウザ描画"| public
  worker -->|"公開文書＋軸ルーブリックのみ"| jev
  api -->|"本人用Match計算"| web
~~~

## アプリケーション／依存方向

~~~mermaid
flowchart TB
  frontend["apps/web: UI + TanStack Query"]
  inbound["apps/api: Hono routes / auth middleware"]
  consumer["apps/crawler: job consumer / process orchestration"]
  app["packages/application: use cases / ports"]
  domain["packages/domain: invariants / matching / state machine"]
  contracts["packages/contracts: shared Zod API types"]
  adapters["packages/infrastructure: Postgres / fetch / browser / Jev"]
  frontend --> contracts
  frontend --> inbound
  inbound --> contracts
  inbound --> app
  consumer --> app
  app --> domain
  app --> contracts
  adapters -. "implements ports" .-> app
  inbound -. "composition root / DI" .-> adapters
  consumer -. "composition root / DI" .-> adapters
~~~

### コンポーネントと責務

| コンポーネント | 所有する責務 | 所有しない責務 |
|---|---|---|
| Web SPA | 診断UI、状態表示、出典、比較、アクセシビリティ | Jevキー、DB管理権限、最終的な権限判定 |
| Hono API | 認証済みコンテキスト、入力検証、レスポンス、リクエストID | HTML解析、独自SQLの散在、評価計算 |
| Application | ユースケース、トランザクションとportの呼び分け、認可要求 | SDK固有型、HTTPのレスポンス詳細 |
| Domain | 軸／版の互換、Hard Constraint、情報不足、Matchの純粋関数 | Jev・Supabase・Hono依存 |
| Crawler | URL取得、安全性、抽出、retry、共通評価の生成 | ユーザーのプロフィールや個人相性 |
| Infrastructure | Postgres/認証アダプタ、Jev、HTTP/ブラウザ取得 | ドメインポリシーの決定 |

## 企業解析ユースケース

~~~mermaid
sequenceDiagram
  participant A as 利用者A
  participant B as 利用者B
  participant API as Hono
  participant DB as PostgreSQL
  participant W as Worker
  participant Site as 企業サイト
  participant J as Jev
  A->>API: POST /api/analyses {url}
  API->>DB: 同一TXでfresh評価/active jobを探索・upsert
  DB-->>API: job-1（新規）
  API-->>A: 202 job-1
  B->>API: 同じURLの解析要求
  API->>DB: 正規化URL＋解析器版で探索
  DB-->>API: job-1（既存）
  API-->>B: 202 job-1
  W->>DB: SKIP LOCKEDでclaim・lease払い出し
  W->>Site: HTTP取得（必要な場合ブラウザfallback）
  Site-->>W: 公開文書
  W->>J: 出典に基づく軸別の狭い判断
  J-->>W: 判断結果（形式をスパイクで確認）
  W->>DB: 短いTX: 文書＋共通評価＋job完了
  A->>API: GET /api/analyses/job-1
  API-->>A: completed + evaluationId
  B->>API: GET /api/analyses/job-1
  API-->>B: completed + evaluationId
  Note over API,DB: ユーザー毎のMatchは共通評価と本人用profileで別途算出
~~~

### 共有ジョブの整合性

- DBの一意キーは正規化済みURL + analyzer_version に対する「活動中ジョブ」。異なる入力URLが同じ求人を指すケースは別のalias統合処理とする。
- 「同じジョブに集約」と「外部処理が厳密に1回のみ」は異なる。worker障害後の再実行（at-least-once）を許し、token付きleaseと冪等upsertで二重確定を防ぐ。
- 活動中のジョブが無いときに評価のfreshnessを**同一DB操作で再確認**し、完了と新規登録の競合を抑える。
- DBをジョブ永続ストアとして使う。外部QueueやRedisは負荷計測後に必要なら導入。専用Queue導入時はoutbox等を別途設計する。

## Matchの流れ

~~~mermaid
flowchart LR
  profile["ユーザー個別: CareerProfile版"] --> match["pure TS: Match Engine"]
  evaluation["共有: 企業/求人評価版"] --> match
  constraint["勤務地・給与等: 明示条件"] --> match
  match --> result["軸別一致・相違・不明／必須条件の衝突／出典"]
  result --> ui["本人だけが閲覧"]
~~~

- Jevの確率値をそのまま「企業特性0〜100」や「適合率%」と解釈しない。共通のルーブリック・較正を先に検証する。
- unknown / conflicting / stale は低スコアに変換しない。給与・リモート等の明示値は決定的コードで比較し、根拠がない場合は不明と表示する。
- N+1対策はBatch repository・ページネーション。SingleflightだけではN+1にならない保証はない。

## 想定ディレクトリ

~~~text
apps/web
apps/api
apps/crawler
packages/domain
packages/application
packages/contracts
packages/infrastructure
supabase/migrations
infra/terraform
infra/gitops
docs
.github/ISSUE_TEMPLATE
~~~

分割は責務の目印。最初から独立パッケージやマイクロサービスを増やす必然性はない。詳細は[DB](database.md)、[API](api.md)、[Infrastructure](infrastructure.md)を参照。
