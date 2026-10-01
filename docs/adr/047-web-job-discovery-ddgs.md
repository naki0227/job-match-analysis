# ADR-047: Job Resolverの非同期Web探索（初期βはDDGSをbest-effortで使う）

> 状態: 決定（2026年10月01日）。ADR-045（Job Resolver）、ADR-021/026/034（取得境界）、ADR-040（crawler Job）を前提にする。

## 背景・課題

ADR-045のJob Resolverは、このサービスで解析済みの求人しか見つけられなかった。URLを知らない利用者が「企業名だけ」または「企業名＋職種」から、Web上に実在する求人へたどり着けるようにしたい。

一方で守るべき制約がある。月額0円であること、API requestの中で外部検索や重いcrawlを行わないこと、SSRF・robotsの境界を緩めないこと、Jevに検索やURL生成をさせないこと。

## 決定

**探索は非同期にし、既存のcrawler workerの中で行う。**

1. API（`POST /v1/job-resolver/search`）:
   - 利用者ごとの検索回数を確認する（`record_job_resolver_search`、超過は429）。
   - 既知の求人（`search_known_job_postings`）だけで足りるか判定する。職種あり: 全語句を含む求人がある。企業名だけ: `JOB_RESOLVER_KNOWN_LISTING_MINIMUM`件以上。
   - 足りなければ、探索jobを登録する（`request_job_discovery`）。同じ企業・職種・雇用形態（正規化した`query_key`）で新しい完了済み探索があればcacheとして再利用する。実行中なら合流する（singleflight）。どちらでもなければ、利用者ごとの回数上限とサービス全体の待ち行列上限を確認して新規に登録し、crawler Jobを起こす。
   - 登録した場合は`searching`と`discoveryId`を返す。Webは`GET /v1/job-resolver/discoveries/:id`をpollingする。
   - **pollingの認可**: 新規開始・実行中の探索への合流・新しい完了済み探索の再利用のいずれでも、`job_discovery_access`に「利用者 ↔ 探索」を記録する。pollingでは、認証した利用者とその探索の対応をサーバー側で確かめる。IDが推測しにくいことを認可の代わりにしない。対応がなければ、存在を隠すため404にする。退会すると利用者側の対応だけがCASCADEで消え、探索と求人は残る。
   - **サービス全体の上限**: `JOB_DISCOVERY_MAX_ACTIVE`の確認と登録は、query単位のlockに続けてglobalのadvisory transaction lockの中で行い、API replicaが複数あっても上限を超えない。lockを取る順序は常に「query単位 → global」で固定する。完了したら、既知の求人と探索結果をまとめて同じ判定（domain）にかける。
   - 失敗・混雑・回数超過のときは、既知の求人で答えるか`not_found`にする。どちらの場合もURLの直接入力へ誘導する。
2. crawler worker（`apps/crawler/src/discovery/`、解析pipelineとは別の責務）:
   - 解析jobが空のときだけ探索jobを処理する。
   - 検索queryは企業名・職種・雇用形態だけから作る（最大`CRAWLER_DISCOVERY_MAX_QUERIES` ≤ 3件、重複は除き、`site:`や引用符などの演算子は除去する）。
   - `WebSearchProvider`で候補URLを得る。**検索結果は手がかりにすぎず、求人とはみなさない。**
   - 正規化（API・crawler共通の`normalizeAnalysisUrl`）したうえで、既存の安全な取得境界を通す。対象はhttpsのみ、IP literal・localhost・内部名は拒否、DNS回答の検査（private・loopback・metadata）、redirectごとの再検査と**別originへのredirectの拒否**、robots.txt、時間・サイズ・content-typeの上限、ログインページの拒否。Playwrightは使わない。
   - 検証（`verifyPosting`）: **JobPosting JSON-LDがちょうど1件**ある、`hiringOrganization`が要求企業と一致する、`validThrough`が過ぎていない、募集終了の文言がない。検索snippetは事実として使わない。
   - 出所の分類: HRMOS・HERPのページは`ats`。ページのhostが、JobPosting自身の宣言する雇用主URL（`url`/`sameAs`）と一致するときだけ`official`。それ以外（求人サイト等）は`web`。「公式」という文言は根拠にしない。
   - 採用ページの入口や一覧ページなら、**同じorigin内で1段だけ**、求人と思われるlinkをたどる（`CRAWLER_DISCOVERY_MAX_LINKS_PER_LISTING` ≤ 20件）。1回の探索で取得するページの総数は`CRAWLER_DISCOVERY_MAX_FETCHES` ≤ 20。
   - 検証済みの求人は既存の`companies` / `source_urls` / `job_postings`に、解析時と同じ同一性の規則（正規化URL＋title＋雇用主名）で保存し、`job_discovery_results`で探索と結びつける。以後は既知の求人として再利用され、同じ会社・求人で毎回DDGSを呼ばない。
3. **DDGSの位置づけ**: 初期βでコストを抑えるため、best-effortの探索providerとして使う。恒久的な基盤とはみなさない。
   - DDGS 9.16.0（PyPI `ddgs`）を固定し、crawler imageの専用venvに入れる。Node側からはsubprocess（`apps/crawler/ddgs/search.py`、stdin/stdoutのJSON）で呼ぶ。
   - subprocessには秘密を渡さない（環境変数はPATHとLANGだけ）。送るのはqueryと件数だけ。
   - `backend="duckduckgo"`を明示する。DDGSは未知のbackend名を受けると、警告だけ出して黙って全engine（`auto`：Google・Bing・Yandex等）に切り替える。そのためscriptは、固定した版であることとDuckDuckGo engineがあることを確かめてから検索し、なければ検索しない。DuckDuckGo engineは`https://html.duckduckgo.com/html/`だけに問い合わせる（DDGSはproviderを`bing`と記録している。DuckDuckGoの結果の出所のため）。
   - imageのbuild時とCIのsmoke testで`--self-check`を実行する。
   - **移行条件**: 利用者の増加、rate limitやblockの頻発、検索品質の不足、providerの仕様変更、SLAが必要になった時、商用規模への拡大。`WebSearchProvider`のadapterを差し替えれば、Tavily・Brave Search API等へ移行できる（domain/applicationはDDGSを知らない）。
4. **Jevとの境界**（ADR-045のまま）:
   - Jevには、検証済みの候補の会社名・職種名・雇用形態・勤務地と、利用者の入力（企業名・職種）だけを渡す。URLや検索snippetは渡さない。
   - 回答は`c1`〜`cN`か`none`。それ以外のIDやURLは`none`として扱う。
   - **企業名だけの検索ではJevを呼ばず、1件に決めない**（一覧を返し、利用者が選ぶ）。

## 上限・cache（すべて設定値。コードに既定値を持たない）

| 項目 | 設定 |
|---|---|
| 利用者ごとの検索回数 | `JOB_RESOLVER_SEARCH_LIMIT` / `JOB_RESOLVER_SEARCH_WINDOW_SECONDS` |
| 利用者ごとの探索回数 | `JOB_DISCOVERY_USER_LIMIT` / `JOB_DISCOVERY_WINDOW_SECONDS` |
| サービス全体の待ち探索数 | `JOB_DISCOVERY_MAX_ACTIVE`（crawler Jobは並列1） |
| 探索結果のcache | `JOB_DISCOVERY_FRESHNESS_SECONDS`（同じquery_key） |
| 探索記録の保持 | `JOB_DISCOVERY_RETENTION_SECONDS`（求人自体は残る） |
| 一覧の件数 | `JOB_RESOLVER_LISTING_LIMIT` ≤ 20（超える分は`hasMore`） |
| 1探索あたり | 検索 ≤ 3、結果 ≤ 10/検索、取得 ≤ 20、1段のlink ≤ 20、保存 ≤ 50 |

## 観測

- API（`job_match.job_resolver.*`）: 検索の結果（resolved / candidates / not_found / searching / rate_limited / failed）、探索の状況（ready = cache hitを含む / pending / unavailable / skipped = 既知の求人で足りた）、応答時間。
- crawler（`job_match.discovery.*`）: 実行数（completed / retry / failed）、検索回数、検索失敗（timeout / blocked / unavailable）、検索結果数、取得数、一覧からたどった数、検証済み数、却下理由（invalid_url / fetch_failed / not_job_posting / multiple_postings / company_mismatch / expired / closed）、所要時間。
- labelに企業名・職種・URL・利用者IDは入れない。

## メリット・デメリット

URLを知らなくても実在する求人にたどり着け、検証済みの求人は全利用者のcacheになる。API requestは外部へ出ない。一方、結果は数十秒後になる（crawler Jobの起動と探索）。JSON-LDを持たない採用ページの求人は見つけられない（誤検出より取りこぼしを選んだ）。DDGSは非公式で、blockや仕様変更で止まりうる（その場合は既知の求人とURL入力で続ける）。

## 見直し条件

上記の移行条件、JSON-LDのない採用ページへの対応（ATS parserの追加、Playwrightを使う非同期取得）、探索の待ち時間への苦情。
