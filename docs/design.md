# Career Fit（仮称）設計書 v0.1

- 作成日: 2026-09-19
- 状態: 実装開始用ドラフト。未検証の仕様・数値は「仮」と明記する。
- 目的: 自分でコードを書きながら、就活時の希望条件・働き方・価値観と企業／求人の公開情報を照合できるWebアプリを開発する。
- 運用方針: 1人開発のScrum-lite。Issue単位で小さく実装し、各Issueに受け入れ条件とテストを持たせる。
- 文書の出自: リポジトリ作成前に作成したv0.1ドラフト。Issue登録・実装・デプロイの進捗はこの文書ではなくGitHub上のIssueで管理する。

## 1. プロダクトの境界

### MVPのユーザーフロー
1. サインインする。
2. 働き方の希望・仕事観の各軸を0〜100のスライダーで入力し、各軸の**重要度も別に**設定する。最低年収・リモート必須などの必須条件は別フォームにする。
3. 企業・求人の公開URLを送信する。既存の評価があればそれを表示し、未解析・更新要なら共有解析ジョブを登録する。
4. 結果待ちのユーザーは同一ジョブの進捗を確認する。解析完了後、共通の企業／求人情報と自分のプロフィールを突き合わせる。
5. 軸別の一致／相違、必須条件への適合、情報不足、参照元URL・取得日時を表示する。保存済み求人を一覧・比較する。

### MVPに含めないもの
- 企業の自動巡回・無差別クロール、求人検索エンジン、Chrome拡張、求人応募自動化、AIによる履歴書採点。
- 人事・企業向けの採否判断や採用選別。**利用者本人の意思決定支援**であり、適性・人格を客観的に診断できるとは表示しない。
- 会社の内部文化、年収、完全在宅可否など、公開資料から確認できない事実を推測で埋めない。

### ドメイン上の重要な区別
- `Company`: 法人・企業。`JobPosting`: 募集中の**個別求人**。URLと会社は1対1ではない。
- `SourceDocument`: 公開ページの取得内容と出典・取得時刻。`CompanyEvaluation` / `JobEvaluation`: 文書に基づく共有評価。
- `CareerProfile`: ユーザーの自己申告・希望。`MatchResult`: 特定のプロフィール版と評価版を比較した個人向け結果。
- 共通評価へユーザーの自由記述・氏名・診断結果を混ぜない。個人情報をJevへ渡すのは、本人専用の評価が本当に必要になった時に別途再設計する。

## 2. 非機能要件（初期案。検証後に調整）

| 観点 | MVPの目安 / 方針 | 検証方法 |
|---|---|---|
| 想定規模 | 登録1,000人、同時アクティブ20人、企業解析要求500件/日（仮） | メトリクスで実測 |
| 通常API | サーバー処理 p95 < 300ms（仮） | Autocannon / 実運用ログ |
| 共有結果からの相性計算 | p95 < 500ms（仮） | APIテスト |
| 新規解析 | HTTP同期処理に閉じ込めず、受付後202+ジョブIDを返す。所要時間は外部サイト依存 | E2E / タイムアウト・障害テスト |
| 解析同時数 | ブラウザ起動は当初1、通常取得を含め最大2程度（仮） | OCI VMで実測 |
| 可用性 | 単一VM障害で停止し得ることを許容。99%は努力目標で保証しない | 障害訓練 |
| データ | FK/UNIQUE/CHECK/Transaction・版管理。日次バックアップ目標は別実装が必要 | DB統合・復元テスト |
| セキュリティ | RLS、秘密鍵分離、URL検証+ネットワーク遮断、管理画面アクセス制限 | 権限・SSRF・シークレット検査 |
| コスト | 固定費は無料枠内を目標。従量API・ドメイン・無料枠超過リスクは別管理 | 利用上限・請求通知 |
| 監視 | request/job ID、状態遷移、p95、失敗率、キャッシュヒット率、Crawler fallback率 | Grafana / 構造化ログ |

## 3. 技術構成と採用理由

| 境界 | 候補 | 採用理由・留意点 |
|---|---|---|
| UI | React + Vite + TypeScript | 診断スライダー・比較画面中心のSPA。SSRを必須にしない。 |
| HTTP API | Hono + TypeScript | フロント／APIの型・実装言語を共有。Honoはrouting/HTTP境界に限定。 |
| 永続化・認証 | Supabase PostgreSQL / Auth | FK、Transaction、RLS、認証の管理コストを減らす。 |
| 意味判断 | Jev APIを`DecisionEngine`ポートの裏へ隔離 | サービス初期は外部API。アクセス・費用・スキーマを実APIで先に検証。 |
| 取得 | HTTP fetch → 内容検査 → Playwright fallback | ブラウザ起動を必要なURLに限定。公開サイト取得方針・robots・規約に配慮。 |
| ジョブ | PostgreSQL上の永続ジョブテーブル | 同一URL重複要求を1ジョブに集約。外部Queueは必要になるまで増やさない。 |
| 実行 | Docker、OCI Always Free VM + k3s（仮） | GitOps学習目的。ただしサービス規模だけならKubernetesは必須ではない。 |
| 公開 | Cloudflare DNS/Proxy + Tunnel | `career.enludus.com`、管理用`argocd-career.enludus.com`。管理画面はAccessで制限。 |
| CI/CD | GitHub Actions → GHCR（digest固定）→ GitOps repo → Argo CD | CIとデプロイ宣言を分離。 |
| IaC | Terraform | VM/ネットワーク/DNS等を管理。DB schemaはSQL migration。 |
| 監視 | JSON logs + OpenTelemetry → Grafana Cloud（仮） | 過度なログ送信を避ける。無料枠は導入時に確認する。 |
| テスト | Vitest、DB統合テスト、Playwright E2E、Autocannon | 単体・境界・操作・性能を分離。 |

> **容量前提の注意:** OCI Always FreeのAmpere A1について、2026-09-19時点でOracle公式ドキュメントは無料テナンシー換算を**合計2 OCPU / 12GB**と記載している。リージョン在庫・無償対象・ARM64用ブラウザイメージを実際に確認するまでは「無料で問題なく動く」と断定しない。固定費ゼロを優先する場合、最初はローカルのDocker/k3dだけで開発し、公開環境はスモーク検証後に導入する。

### 概念構成

```text
Browser (React/Vite SPA)
  └─ HTTPS /api/* → Cloudflare → Tunnel → k3s: Hono API
                                     ├─ Auth / CareerProfile / MatchEngine
                                     ├─ Supabase PostgreSQL + Auth
                                     └─ AnalysisJobs (DB) → crawler worker
                                                          ├─ HTTP fetch / Playwright
                                                          ├─ Source extractor
                                                          ├─ Jev DecisionEngine
                                                          └─ DB transaction

GitHub Actions → GHCR(image digest) → GitOps PR/merge → Argo CD → k3s
Terraform → OCI・ネットワーク・Cloudflare（Argo CDの管理物と二重管理しない）
```

## 4. アプリ境界と責務

```text
apps/
  web/                   # React SPA。画面、入力、表示、APIクライアント
  api/                   # Hono routes、認証・認可middleware、DI、HTTP adapter
  crawler/               # URL取得・検証、ブラウザ fallback、抽出、ジョブconsumer
packages/
  domain/                # 値オブジェクト、必須条件、相性計算、状態遷移。外部依存なし
  application/           # ユースケースとRepository/DecisionEngine/Fetcherポート
  contracts/             # API request/response・共有のZod schema
  infrastructure/        # DB、Jev、fetcher実装（必要ならpackagesを後で分割）
supabase/migrations/     # SQL migrations / RLS / DB functions
infra/terraform/         # 後続のIaC
infra/gitops/            # 初期は同一repoでも可。GitOps独立repo移行は後続Issue
```

- `Hono route → application use case → domain + interface`。DBクライアント・Jev SDK・fetchをドメインにimportしない。
- 現段階でpackagesを無理にすべてnpm package化する必要はない。コードの責務境界を優先し、実際の循環依存がないかを検証する。
- APIはコントローラーのみ。ジョブ状態とマッチング式はHTTPから独立してVitestで検証する。

## 5. 評価・マッチング仕様（未確定部分は仕様スパイクを行う）

### 入力
- ユーザー: 軸ごとに`preference: 0..100`と`importance: 0..100`。必須条件は別オブジェクト（最低年収、勤務形態、勤務地、職種など）。
- 企業・求人: **公開資料に裏付けられる項目のみ**保存。企業共通（文化・制度など）と求人固有（給与・技術・勤務地・職種など）を分離。
- 情報の状態: `known / unknown / conflicting / stale`。`unknown`を0点扱いしない。出典のURL、抽出箇所、取得日を保持。

### Jevの役割と注意
- Jevは選択・ルーブリック評価などの**狭い問い**を処理する。給与や勤務条件の数値比較、必須条件の充足はコードで実施。
- **JevのScoreとユーザースライダー0〜100は同一尺度とは限らない。** 実際のAPIのScore段階数・出力形式を確認し、明文化した共通ルーブリックと変換関数を定めるまで総合点を固定しない。
- **`confidence`は事実の証拠ではない。** 該当ページの明示記載がない属性は不明。引用可能な根拠位置はFetcher/Extractor側で保持し、モデルの推測を出典として扱わない。
- 初期表示は軸別の「一致・相違・不明」と根拠を優先。%の総合適合度はルーブリックの妥当性検証後に追加する。
- 価値観診断は自己申告であり、人格・能力・採用適性の医学的／心理測定的な診断ではない。評価を人の採否判定に転用しない。

### 版管理
- `assessment_axes (axis_key, axis_version)`、`career_profile_versions`、`evaluation (source_set_hash, rubric_version, evaluator_version, model)`、`match_results (profile_version, evaluation_id, algorithm_version)`。
- 過去の結果を表示する場合、どの版を組み合わせたかを保持する。利用者のプロフィール更新で履歴を上書きしない。

## 6. DB論理モデルと制約

```text
auth.users 1─1 profiles 1─N career_profile_versions 1─N career_profile_axis_values
                                               └─1 career_constraints
assessment_axes 1─N career_profile_axis_values
assessment_axes 1─N evaluated_axis_values
companies 1─N job_postings
source_urls 1─N source_document_versions
companies / job_postings → evaluation_targets → evaluations
source_document_versions N─M evaluations（evaluation_sources）
evaluations 1─N evaluated_axis_values 1─N evaluation_evidence
source_urls 1─N analysis_jobs（有効ジョブ一意）
profiles N─M job_postings（user_saved_jobs）
career_profile_versions + evaluations → match_results → match_axis_results
```

設計ルール:
- URLは`raw_url`と`normalized_url`を区別し、`source_urls.normalized_url`へUNIQUE。utm等の追跡パラメータ以外を機械的に捨てない。リダイレクト先が同じでも元URLの別名管理が必要。
- `job_postings`の同一性はURLだけに依存せず、求人ID等があれば併用。`companies.name`のみでUNIQUEにしない。
- `career_profile_axis_values`は`(profile_version_id, axis_id)` PK、両値とも0〜100 CHECK。軸versionの混在はアプリの検証に加えDBでも整合性検証。
- `evaluations`の再利用キーは`target_id + source_set_hash + rubric_version + evaluator_version + model_version`を基本とする。
- `analysis_jobs`は`(source_url_id, analyzer_version)`について`queued/running`状態の部分UNIQUE INDEXを付与。完了後のキャッシュ有効性と再解析の判定は別ロジック。
- `match_results`は同一ユーザーに属するプロフィール版だけ参照できるよう**所有権をApplication + DBで検査**。`career_profile_axis_values`等の子テーブルRLSは親へのEXISTSで判定。
- `assessment_axes`・共有企業情報は読取範囲を定義し、更新はサーバー専用にする。管理用DB鍵はブラウザに公開しない。
- 削除: ユーザーの個人データは削除要求で消せる設計とする。共有企業データの削除で他ユーザーの履歴が不用意に消えないよう、CASCADE/RESTRICT/soft-deleteを各FKで精査する。

### Transaction境界
1. プロフィール回答→`career_profile_version + axis_values + constraints`の確定を一度にCOMMIT。
2. 解析要求→**キャッシュ再確認、source_url upsert、ジョブ新規作成/既存ジョブ参照**を競合に耐える単一DB操作（DB function等）にする。
3. worker完了→source versions・評価・軸評価・根拠・ジョブ`completed`の切り替えを短いTransactionで確定。
4. ユーザーマッチング結果の保存→結果と軸明細を同一Transactionで確定。
5. HTTP取得・ブラウザ描画・Jev API呼出しの間はDB Transactionを保持しない。Supabase JSの独立した複数呼出しだけで原子性が得られると考えない。

## 7. 共有解析ジョブとキャッシュ

```text
POST /api/analyses {url}
 → URL検証・正規化
 → DBで有効な評価と解析ジョブを原子的に再確認
    ├─ fresh evaluation → 200 + evaluationId
    ├─ stale evaluation → 200 + stale=true + refresh jobId（重要条件は再確認表示）
    └─ 未評価 → 202 + jobId（既存jobを再利用可）
 → workerがleaseを取得してqueued→running
 → HTTP fetch、内容不足ならPlaywright fallback
 → 抽出+情報不足検査 → Jev（必要な軸のみ）
 → 1回のDB確定処理で評価保存 + job completed
 → 利用者ごとにCareerProfile×共有Evaluationを比較
```

- **Singleflight保証の範囲**: 同じ正規化URL＋解析器版の活動中ジョブを原則1件にする。永続ジョブの重複防止と、外部APIの厳密なexactly-once実行は別。worker停止やlease切れによる**at-least-once再実行**を想定し、書込を冪等にする。
- lease: `lease_until`、`attempts`、`worker_token`を記録。完了UPDATEは自分のtokenかつrunningの時だけ許可。期限切れを回収するreaperを設け、最大試行数を超えたらfailed。
- ジョブをDBで管理するMVPでは、DB書込みと外部Queue送信の二重書込み問題を避ける。将来専用Queueが必要ならoutboxを含めて再設計。
- 段階的失敗: 検証失敗→即時4xx、取得不能→failed、Jev不調→取得文書を保持して再試行。永久失敗と一時失敗を分ける。
- HTTPレスポンスを待ち続けず、`GET /api/analyses/:jobId`で状態確認。将来SSEを追加可。
- 取得データは無期限の真実ではない。暫定: 求人条件24時間、企業概要30日を目安にし、重要条件にstale表示を出す。公開URL変更・求人終了を扱う。
- N+1対策は別: 一覧取得は`findByIds`/`findLatestByTargetIds`など一括取得＋ページネーション。ジョブ集約だけではN+1は解消しない。

## 8. API contract（詳細はIssueでZod schemaを確定）

| Method | Path | 主な結果 |
|---|---|---|
| `GET` | `/api/me` | 認証ユーザー |
| `PUT` | `/api/me/career-profile` | バリデーション後、プロフィール新バージョンを原子的保存 |
| `GET` | `/api/me/career-profile` | 最新確定版 |
| `POST` | `/api/analyses` | `200`既存評価／stale or `202`共有ジョブ、または検証エラー |
| `GET` | `/api/analyses/:id` | `queued/running/completed/failed`、評価ID。アクセス許可と公開範囲を確認 |
| `GET` | `/api/jobs/:id` | 求人・出典・鮮度・共有評価 |
| `POST` | `/api/matches` | 認可済みCareerProfile版×共有評価の個人結果 |
| `GET` | `/api/me/saved-jobs?cursor=...` | 一括取得＋ページネーション |

- 共通エラー: `code`, `message`, `requestId`。内部詳細・個人情報・秘密鍵を返さない。
- 解析要求・結果確定は冪等性を持たせ、再送と並行リクエストの統合テストを必須にする。

## 9. セキュリティ・プライバシー

- 入力URLは`https:`（必要なら`http:`も方針検討）のみ。URL長・文字種・ポート・redirect上限・応答バイト数・実行時間を制限する。
- DNS解決と接続先を検査し、ループバック、プライベート、リンクローカル、クラウドメタデータIP等への接続を禁止。**ブラウザが取得する画像・JS・XHR・リダイレクト先も対象**。ネットワークレベルのegress制限も併用する。
- PlaywrightのCrawlerは低権限ユーザー、必要最小限のネットワーク・ファイル権限、同時数制御。対象サイトの規約・robots等を確認し、ログイン必須ページやアクセス制限の回避はMVP対象外。
- RLS: 個人テーブルは所有者のみ。子テーブルは親のuser_idを参照して認可。共有テーブルは読取範囲を限定し、更新は許可されたサーバー処理のみ。
- Jevへ送るのは公開企業情報と評価質問が原則。氏名・メール・プロフィール全文等は共通解析から排除。プロンプトインジェクション対策として取得本文を**命令ではなく未信頼データ**として扱う。
- 外部ログには本文全文、診断自由記述、JWT、APIキー、実URLの機密クエリを送信しない。requestId/jobId、latency、結果区分、抽出量などを記録。
- Argo CD管理画面はCloudflare Accessで認証し、一般公開しない。GitHub Actions権限・GHCR pull資格情報は最小化。

## 10. テストと受け入れ条件

- Domain/Unit (Vitest): 軸の0〜100境界、重要度0、必須条件、`unknown`除外、バージョンの不一致、数値の単位差。
- DB/Integration: FK・RLS・Transaction rollback、同じURLを同時100リクエストでジョブ1件、期限切れleaseの引継ぎ、重複完了書込みの冪等性。
- Crawler/Fixture: 静的HTML／JS描画必要／リダイレクト／巨大HTML／robots・取得不可／SSRF（サブリソース含む）／公開情報不足。
- DecisionEngine: Jev呼出しの契約テスト（機密送信なし、API実体は少量だけ使用）。CIの主系はfake実装と固定Fixtureを使用。
- E2E (Playwright): ログイン済みfixture → 診断 → URL入力 → 共有ジョブ再利用 → 出典付き結果 → 保存・比較。
- Performance (Autocannon): キャッシュhit・一覧Batch・API p95。外部サイトとJevへ負荷試験を流さない。
- CI (PR): format/lint → typecheck → unit → DB統合 → E2E smoke → image build / security scan。mainのみGHCR push、GitOpsの変更PRで配備。

## 11. Scrum-lite（個人開発用）

- **期間**: 1週間を1スプリントの目安にする。儀式を増やしすぎず、週の初めに目標、週末に動くもののデモと振り返り。
- **Issueの粒度**: 原則、単一の技術責務を実装・テスト・レビューできるサイズに分割。「企業解析全部」など横断的な大IssueはEpicとする。
- **ボード**: Backlog → Ready → In Progress（WIP 1）→ Review/Test → Done。障害はBlockedへ。
- **優先度ラベルは付けない**。代わりに `type:*`、`area:*`、`milestone:*` と`blocked by #...`を使い、先行条件とリリース範囲で並べる。
- **Issueテンプレート**: 背景 / スコープ・非スコープ / 入出力・不変条件 / 実装のヒント（完成コードは書かない） / 受け入れ条件 / テストケース / 依存Issue / 振り返りメモ。
- **手書き学習の進め方**: まず要件・設計判断を説明 → ユーザーが実装 → 差分・失敗ログを見て質問形式でレビュー。完成コード一括生成、勝手なPR作成、無断コミットはしない。
- **Definition of Done**: 仕様の受け入れ条件を満たす、テスト通過、必要なmigration/README更新、秘密情報未混入、CI green、本人が「なぜその設計か」を説明できる。

### 最初のマイルストーン（Issueを作るときの分割案）

| 順番 | Milestone / Epic | 完了したと判断する条件 |
|---|---|---|
| 0 | Jev/API・OCR不要の企業ページ取得・ARM64実行の技術スパイク | 実API契約とコスト、静的/JSサイト各1件、ローカルCrawlerの動作確認。無理なら構成を見直す |
| 1 | ドメインとプロファイル | 軸定義、バージョン付き入力、Hard Constraints、純粋関数のテスト完了 |
| 2 | DB・認証 | migration/FK/RLS/Transaction、他ユーザーへの権限テスト完了 |
| 3 | 共有URL・ジョブ | 正規化、一意ジョブ作成、lease/再試行、並列テスト完了 |
| 4 | 企業取得・Jev | 出典と鮮度が保持され、同じURLが再利用される |
| 5 | Matching + UI | ユーザーが手元でログイン→診断→URL→理由つき結果を完走 |
| 6 | 品質・公開 | E2E、負荷・監視、Docker/CI、必要最小限の公開を確認 |
| 7 | GitOps運用（サービス機能とは独立） | OCI/k3s・Terraform・GHCR・Argo CD・ロールバックの実証 |

> マイルストーンは作業の**依存順**であり、重要度の点数付けではない。Milestone 5までを先にローカル／最小環境で成立させ、GitOpsを完成のブロッカーにしない。

## 12. 実装前の未確定事項・判断記録

- サービス名は仮称。`career.enludus.com`と`argocd-career.enludus.com`は暫定確定。
- 質問文、ルーブリック、Score段階と0〜100への変換方法、総合点の是非は技術スパイクとユーザーテスト後に決定。
- Jevの早期アクセス可否、現行の料金・契約、SDK/API仕様、利用上限を実キーで確認する。利用不可でもFake DecisionEngineで開発を止めない。
- OCI Always Freeの割当・ARM64イメージ・k3s/Argo CD/Chromiumの実測が未完了。単一ノード運用では冗長性なし。
- 共有企業データと求人データのライセンス・保存期間・利用規約、個人データの保存期間と削除経路は公開前に決定。
- RPO/RTOは目標と実際のバックアップ機能を一致させてから「要件確定」とする。

## 参照（設計検証用）

- TypeSafe公式概要: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- TypeSafe公式ドキュメント: https://docs.typesafe.ai/introduction
- Oracle Always Free公式: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Playwright Docker/Crawler運用: https://playwright.dev/docs/docker
- Playwright対応環境: https://playwright.dev/docs/intro