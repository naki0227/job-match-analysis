# 設計判断記録 / ADR候補 v0.1

## 決定済み（ただし実測により変更可能）

| ID | 決定 | 理由 | 明示的なトレードオフ |
|---|---|---|---|
| ADR-001 | React + Vite SPA + Hono / TypeScript | 主体はログイン後の対話的画面、フロント/APIで型共有 | SSR / Next.jsの機能を当面利用しない |
| ADR-002 | 個人Profileと公開情報の共有評価を分離 | プライバシー、cache reuse、個人ごとの計算をpure TSにする | 会社評価・求人評価・matchの版管理が必要 |
| ADR-003 | URLごとにPostgres-backed共有ジョブ | 重複Fetch/Jevを抑えDBの原子性を利用 | DBジョブ表・lease/reaperの実装が必要 |
| ADR-004 | HTTP取得 → 内容不足時Playwright | JS依存ページと軽いページの両方に対応 | ブラウザリソースとSSRFの制御が必要 |
| ADR-005 | OCI single VM + k3s + Argo CD（導入は後段） | IaC/GitOpsの実装学習 | 単一障害点、無料枠やCPU/RAM制限 |
| ADR-006 | Terraformはクラスタ外、Argo CDはK8s内 | 同じリソースの二重管理を防ぐ | bootstrapとsecret管理が必要 |
| ADR-007 | バッチで複数評価を取得 | DB N+1抑制 | join条件・Indexの検証が必要 |
| ADR-008 | 採用適性の断定をしない | 本人向けの比較・意思決定支援に限定 | 結果表示の表現／根拠の設計が必要 |
| ADR-009 | Jev APIの直接HTTP/Zod契約を検証。呼び出し元の配置はADR-027で更新 | 実APIによるNoul / Choice / Scoreの入出力を確認した | Jev固有のschema・error mapping・timeout/429処理を保守する必要がある |
| [ADR-010](adr/010-assessment-axes.md) | MVPの就業価値観は8軸で定義する | 本人の希望を分けて表し、各軸を公開資料の根拠で確認する | 入力負担と `unknown` が増える |
| [ADR-011](adr/011-importance-and-hard-constraints.md) | 重要度0は比較から除外し、必須条件は個別求人の明示情報で判定する | 未回答と区別し、根拠のない推定を避ける | 判定不能の `unknown` が増える |
| [ADR-012](adr/012-domain-identifiers.md) | CareerProfileは固定の8軸ID・共通カタログ版と2桁の都道府県コードを使う | 版混在と表記揺れをドメイン境界で拒否する | 軸変更時は全体を新版にし、市区町村・海外は別途拡張が必要 |
| [ADR-013](adr/013-match-engine-policy.md) | 軸ごとの0/50/100アンカーを比較し、求人と会社の結果を分離する | 総合％に頼らず根拠と相違を示す | 境界値と情報不足の扱いを検証し続ける必要がある |
| [ADR-014](adr/014-postgresql-physical-schema.md) | UUID・複合FKを中心に物理DDLを定義し、RLSを先に有効化する | 個人/共有/出典の整合性をDBで保証する | 本文30日削除はworker周期に接続済み。停止中は期限超過し得る |
| [ADR-015](adr/015-target-roles-in-career-profile.md) | 希望職種をCareerProfile版の必須リストとして保持する | 再評価時にも当時の希望を追える | 職種の正規化と自動一致は別途決める |
| [ADR-016](adr/016-google-auth-and-personal-read-rls.md) | Google OAuth、APIでのprofile初期化、本人参照のみのRLS | 個人データを所有者に限定し、変更をAPIへ集約する | Google provider設定の実ログイン検証が必要 |
| [ADR-017](adr/017-atomic-profile-and-evaluation-commits.md) | プロフィールと評価をそれぞれ1回のRPCで原子的に確定する | 部分確定と再送時の重複を防ぐ | サーバーとDB関数の入力契約を合わせる |
| [ADR-018](adr/018-saved-jobs-batch-pagination.md) | 保存済み求人一覧の旧設計。ADR-023で置換 | DB往復のN+1を防ぐ手法を確立した | 旧テーブル/RPCはIssue #45で廃止 |
| [ADR-019](adr/019-shared-web-api-contracts.md) | Web/APIのZod契約をpackages/contractsへ分離する | server実装やdomainへの逆依存を避ける | workspaceのbuild順序が必要 |
| [ADR-020](adr/020-career-profile-api.md) | 診断GETは本人JWTでRLS適用、PUTはサーバー専用RPC | 本人確認と原子的な版保存を両立 | 読取は版・子行の複数問い合わせ |
| [ADR-021](adr/021-safe-public-fetch-boundary.md) | 公開URLは接続時にDNS全回答を検査してIPを固定し、redirectとブラウザ要求も同じ取得境界に通す | URL事前検査後のDNS切替とサブリソース経由の内部接続を防ぐ | 対応ページに制限があり、ネットワーク層のegress検証は#36が必要 |
| [ADR-022](adr/022-private-profile-education-legal-history.md) | 任意プロフィール・複数学歴・版付き法的文書と確認履歴を分離する | 就業希望版と認証メールの責務を守り、文書版ごとの確認を追跡する | 入力API/UIと法的本文の公開運用は別途必要 |
| [ADR-023](adr/023-analysis-history-from-matches.md) | 保存操作をなくし、本人の求人Match結果を分析履歴の元にする | 二重の状態管理をなくし、再分析の版を残す | 一覧の重複除去はMatch件数に応じて再評価する |
| [ADR-024](adr/024-atomic-analysis-registration.md) | 正規化URL行ロックの1 RPCでcache確認と共有ジョブ参加を直列化する | 同時受付・完了直後の重複ジョブを抑える | 同一URLへの集中時は行ロック待ちを実測する |
| [ADR-025](adr/025-analysis-job-leases.md) | SKIP LOCKEDのclaimとworker token/leaseで停止後のジョブを引き継ぐ | 多重workerでも1件ずつ所有し、旧tokenの確定を拒否する | lease長・試行上限の運用値と外部API予算は実測後に決める |
| [ADR-026](adr/026-crawler-source-extraction.md) | robots確認後、HTTP本文不足時だけブラウザで取得する。手動サイト承認の判断はADR-034で更新 | 費用と誤抽出を抑え、会社と求人を分離する | 取得頻度と実サイトでの抽出精度は運用前に確認 |
| [ADR-027](adr/027-decision-engine-worker-boundary.md) | Jev通信をCrawler workerのDecisionEngine境界へ置く | API受付を短く保ち、leaseと外部評価を同じ処理にする | WorkerへのSecret注入と費用制御が必要 |
| [ADR-028](adr/028-decision-engine-evidence-contract.md) | 出典候補ごとにJev Choiceで明示アンカーを判定し、低確度はunknownにする | Jev Scoreを希望値と混同せず、根拠IDを入力候補に限定する | 候補生成・個人情報除去・実ページでの較正が必要 |
| [ADR-029](adr/029-public-evidence-selection.md) | 8軸の公開アンカーと版付き文候補を評価入力に使う | scope・出典位置・再取得時点を追跡する | 語の取りこぼし、個人情報除去、引用長の実ページ検証が必要 |
| [ADR-030](adr/030-analysis-api-contract.md) | Google認証後に共有解析をPOST/GETし、ジョブの公開状態だけを返す | 同期的な外部評価を避け、プロフィールと共有状態を分ける | 認証ユーザーは既知jobIdの共有状態を読める。運用上の量制限が必要 |
| [ADR-031](adr/031-web-ui-structure.md) | Web画面は機能別に分け、解析ジョブの状態を純粋関数とTanStack Queryのポーリングで表示し、結果表示はWeb側view modelで先に検証する | 未定義のAPI契約を増やさず、cache hit・stale・失敗・timeoutを区別する | URLから画面を復元できず、Match API接続時に対応付けが必要 |
| [ADR-032](adr/032-match-api.md) | 解析完了後にWebが本人のMatchをPOSTし、application層でdomain比較→1 RPCで保存する | 分析履歴の元を残し、所有者・snapshot一致をDBで保証する | 求人条件が未保存で必須条件は当面unknown、実データ確認はworker接続後 |
| [ADR-033](adr/033-analysis-history-delivery.md) | 本人の解析依頼を共有jobと別表に原子的に記録し、再訪時に未反映評価をMatchへ変換する | 離脱後も分析済み企業へ反映し、共有jobに個人情報を持たせない | 初回反映の遅延・20件上限を実測で確認 |
| [ADR-034](adr/034-public-crawl-eligibility.md) | 公開HTTPSページはrobots許可を取得条件とし、サイト別の手動承認を必須にしない | 任意の公開求人URLを扱えるようにする | 利用条件上の許諾までは保証しない。問題のあるサイトは遮断する |
| [ADR-035](adr/035-job-target-from-structured-metadata.md) | 単一のJobPosting JSON-LDから求人名と雇用主名を読み、URL内だけで評価対象を再利用する | 会社名・ホスト名だけの誤統合を防ぐ | JSON-LDのないページは未対応。対象行が評価前に残ることがある |
| [ADR-036](adr/036-deterministic-evaluation-pipeline.md) | 明示的な求人条件と軸ルールを先に確定し、残りの根拠候補だけJevへ渡す | 外部推論の費用と揺れを抑え、評価方法を追跡する | 表記揺れと候補上限によるunknownを実ページで検証する |
| [ADR-037](adr/037-public-match-share.md) | 本人Matchの公開は作成時に保存した共有projectionだけを推測困難なtokenで返し、本人が失効できる | 匿名読取が個人の表に触れず、希望値・必須条件・根拠を公開しない | 共有後の再計算は反映されず、OG画像は未対応 |
| [ADR-038](adr/038-account-deletion-and-shared-data.md) | アプリ内退会でAuth userを削除し、CASCADEで個人データ・公開リンク・確認履歴を消す。共有評価と再識別できない集計値は残す | 1回の削除で漏れなく消し、他ユーザーが使う評価を壊さない | 削除は取り消せず、確認履歴も残らない |
| [ADR-039](adr/039-analysis-quota-and-jev-budget.md) | 新規解析は利用者ごとにDBで数えて上限を超えたら429、Jevは日次予算を予約できた時だけ呼び、切れたらunknownで保存する | 複数プロセス・同時要求でも超過せず、サービス全体を止めない | 上限値は運用設定、予算切れ評価は鮮度期間中再利用される |
| [ADR-040](adr/040-free-mvp-hosting-split.md) | 月額0円MVPはWebをCloudflare Pages、APIをAzure Container Apps、crawlerをContainer Apps Job、DB/AuthをSupabase Free、imageをGHCRに置く。OCI/k3sは後続 | 既存のNode API・Playwright crawler・DBのjob管理をそのまま使え、無料枠内で動く | scale to zeroの初回遅延、Job起動待ち、egress制御の限定 |
| [ADR-041](adr/041-operational-observability-boundary.md) | 運用観測はOTelで計装し、Grafana Cloud FreeへOTLPで直接送る。Datadogは将来の追加候補 | ベンダー非依存、送信失敗でも本体が止まらない、0円で運用観測できる | Grafana Cloud Freeの上限と保持14日 |
| [ADR-042](adr/042-abuse-signals.md) | 不正利用signalは生IP/UAを保存せず、日次HMACの仮名を7日だけ保持し、security用途に限る | 利用者ID上限の回避を仮名で検知しつつ追跡を難しくする | 日をまたぐ追跡不可、信頼proxy境界がない時はIP signalなし |
| [ADR-044](adr/044-whole-context-evaluation.md) | 求人評価はkeyword事前選別をやめ、上限付きの本文断片を1回のJev requestで全未解決軸について判定し、根拠断片を複数保存する。根拠を特定できない判定はunknown | 言い回しに依存せず判定でき、根拠が複数残る。1求人1回の上限でコストを抑える | 入力tokenの増加、上限超過時の優先付けは語彙依存が残る |
| [ADR-045](adr/045-job-resolver.md) | 企業名＋職種から既存の求人を特定するJob Resolverを、機械的なdiscovery（既存DB、opt-inのATS公開一覧）→domainによる絞り込み→Jevによる候補IDの選択（URLは生成させない）で構成する。曖昧なら上位3件を利用者に選ばせる | 存在しない求人を指さない。判定基準を説明でき、URL入力も残る | 初期は解析済み企業のみ。公式採用ページは未対応。検索回数の制限なし |
| [ADR-046](adr/046-legal-consent-flow.md) | 利用規約（同意）とプライバシーポリシー（確認）の現在の版への記録を利用開始の条件にする。本文はDBが正、記録はserverが現在版だけを受け付け、文書未登録時はfail closed | 誰がどの版にいつ同意したかを示せ、改定時に再同意を求められる | 有効な文書が未登録だと誰も利用できない（意図どおり） |
| [ADR-047](adr/047-web-job-discovery-ddgs.md) | 既知の求人で足りない時だけ、crawler workerで非同期にWeb探索する。検索（初期βはDDGSのDuckDuckGo backendをbest-effort、`WebSearchProvider`で差し替え可能）は手がかりにとどめ、安全な取得とJobPosting JSON-LDの検証を通った求人だけを既存の表へ保存する | URLを知らなくても実在する求人に届き、API requestは外部へ出ない。検証済みの求人は全利用者で再利用される | 結果まで数十秒。JSON-LDのない求人は見つからない。DDGSは非公式でblockされうる |
| [ADR-048](adr/048-full-page-job-understanding.md) | 求人ページ全体を落とさず読む。描画用subresourceに別の上限、ラベルと値を1 fragmentに、自然な位置で分割し、見出し単位の内容を原文で引用する。parserで読めない事実と見出しのないsectionは、Jevに位置だけを選ばせて原文から読む | どの値にもページ上の根拠があり、推測でunknownを減らさない。比較の前に求人の内容を原文で確認できる | 描画の通信量の上限が増え、Jevへの質問が最大7問増える。見出しの語彙に頼る |
| [ADR-049](adr/049-axis-range-observation.md) | 根拠はあるが隣接する2つのanchorに割れる軸を範囲（例: 50〜100）として記録し、両端で比較する（close / partial「一部近い」/ different） | 「書いていない」と「幅がある」を区別し、推測なしで比較できる範囲を広げる | DB・domain・contract・UIの変更が大きい。履歴の集計はpartialをまだ数えていない |
| [ADR-050](adr/050-non-ats-job-pages.md) | robots.txtの4xx（429を除く）はルールなし（RFC 9309）。ランドマークのないページはbodyを本文にし、JSON-LDのない求人はh1・og:site_name・titleの一致から同一性を作る。文字列の`hiringOrganization`を受け付ける。DDGSの「結果なし」は再試行できる失敗にする | LINEヤフー・アクセンチュアなどATS以外の求人をURLから解析できる | 4xxのrobotsを根拠に取得するサイトが増える。探索の質は残課題 |

## 技術スパイクで検証・継続確認する項目

1. Jev APIの認証・Noul / Choice / Score・usage・基本的な異常系処理は実APIとmockで検証済み。
   具体的なRPM / TPM、429時のRetry-After、アカウント固有の利用上限は未確認。
   Jev Scoreを0〜100の企業適合率として直接利用する根拠はない。
2. 公開企業ページはHTTPだけでは不足する可能性がある。静的HTML/JS描画各1例で本文抽出品質と規約を確かめる。取得した企業本文は未信頼データとして扱う。
3. OCI Always Free VMのARM64ブラウザ・Argo CD・k3sを同居させた時のCPU・RAM・起動時間・無料枠の現状は実測前。運用環境が確保できなくてもlocal開発を進められるようにする。
4. Postgresジョブ管理の同時実行・終了直後のrace・lease更新・可視性・低頻度ポーリングを統合テストする。
5. 企業URLの正規化と同一企業／求人へのalias統合は別の問題。URL queryから求人ID等を機械的に削除しない。
6. 本人の回答は自己申告であり、人格の「正解」や企業への「適性」を客観的に測定できたと表現しない。Job情報が不足するときはunknown。

## 技術スパイク結果

### Jev API

実APIを用いて以下を確認した。

- `POST /v1/systemone` をTypeScriptの`fetch`から利用可能
- `JEV_API_KEY`によるBearer認証
- Noul / Choice / Scoreのレスポンス
- `usage.input_tokens` / `usage.output_tokens`
- `x-typesafe-request-id`
- timeout
- Zodによるruntime validation

Noulは命題がyes / trueである確率を0〜1で返す。

Choiceは各criteriaのprobabilityと、最も高い候補を返す。

Scoreはrubric levelに対する確率加重期待値であり、小数値を取り得る。
そのため、0〜100のユーザー嗜好度や企業適合率とは直接対応しない。

`usage.input_tokens` / `usage.output_tokens` は整数またはnull。

異常系は以下へ正規化する。

- timeout → `JevTimeoutError`
- HTTP 429 → `JevRateLimitError`
- その他のHTTP error → `JevApiError`
- network failure → `JevNetworkError`
- invalid JSON / schema violation → `JevInvalidResponseError`

通常の200レスポンスではrate-limit系headerを確認できなかった。
具体的なRPM / TPMや429時のRetry-Afterは未確認。
意図的な大量リクエストによる429発生試験は行わない。

## 明示的に未確定

- [8軸の仕様](assessment-axes.md)に関する求人の地名から都道府県コードへの正規化とAPIでの `unknown` の表現。
- 実ページでの8軸ルーブリック較正、score→表示値の変換・総合点を出す妥当性。最初の公開アンカー`public-anchors-v1`はADR-029、短い明示表記を含む候補選択`axis-keywords-v2`はADR-036、評価器境界はADR-028に記録した。
    - Jev Score は rubric level に対する確率加重期待値であり、0〜100 のユーザー嗜好度・企業適合率とは直接対応しない。
    アプリ側で適合率へ変換する場合は、Jev Score とは別の明示的な正規化ルールを設計する。
- Supabase無料枠におけるバックアップ実装と復元訓練、個人データ削除要求の実行経路、評価根拠の保持期間。抽出本文は取得から30日後にworker周期で削除する。実際の周期と停止時の遅延は運用値。
- crawlerの取得頻度、無料枠を超えないジョブ上限、ブラウザのネットワークレベルSSRF防御。アプリ側のURL/DNS/redirect境界はADR-021、robots取得不可時の保留と抽出方式はADR-026、公開サイトの取得可否はADR-034で定義済み。
- AWS等への移行条件、実際のSLO、service名（現状はjob-match-analysis仮称）。
- 求人別と会社別の評価継承、出典抽出の引用長と二次利用規約。共有jobIdの状態閲覧範囲はADR-030で決定済み。
- 未実装endpointの正式なAPI prefixとZod契約。診断プロフィールと共有解析は`/api/v1`と共有Zod契約で実装済み。

未確定項目を確定事項としてコードに埋め込まない。各Issueの実験・レビュー結果をここにADRとして追記する。
