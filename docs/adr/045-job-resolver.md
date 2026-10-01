# ADR-045: Job Resolver — 企業名と職種から既存の求人を特定する

> 状態: 決定（2026年10月01日）。ADR-021/026/034（取得境界）、ADR-044（評価）を前提にする。

## 背景・課題

利用者は求人URLを自分で探して貼る必要があった。最終的には「企業名＋職種」から求人を特定したい。ただし、AIにWeb探索やURL生成をさせると、存在しない求人や意図しない取得先を作る余地が生まれる。また、会社名だけでは新卒・中途・職種・地域の違う求人を一意に決められない。

## 決定

**責務の分離**: Job Resolverは「探す」だけを担う。analysisは従来どおり`POST /v1/analyses`（URL検証・取得境界・共有cache）を通る。crawlerに検索の責務は入れない。

| 層 | 責務 |
|---|---|
| domain（`job-resolution.ts`） | 会社名の正規化（法人格・全半角・記号）、同じ会社か、雇用形態の矛盾（明記された場合のみ除外、書いていなければ推測しない）、職種語句による順位付け、判定方針 |
| application（`resolveJob`） | 候補取得元（`CandidateSource`）をまとめ、失敗した取得元は除外して続行する。選択器（`CandidateSelector`）は機械的に絞った候補にだけ使う |
| API | `POST /v1/job-resolver/search`（Google認証必須）。候補取得元と、Jevによる候補ID選択 |
| Web | 基本は企業名＋職種＋雇用形態（任意）、詳細として求人URLの直接入力 |

**候補の取得（discovery）は機械的に行う**:
1. **既存DB**（`search_known_job_postings`、service_roleのみ）: このサービスで解析済みの求人。外部取得なし。
2. **ATS adapter**（HRMOS・HERP）: 既存DBの求人URLからATSとcompany slugを知り、そのATSの**公開一覧ページ**だけを読む。private APIは使わない。
   - URLはadapterが検証済みslugから組み立てる。https、許可したhostと完全一致、redirectなし、1MB・時間の上限、robots.txtに従う。
   - **初期値は無効**（`JOB_RESOLVER_ATS_SOURCES`で明示的に有効化する）。各ATSの利用規約とrobotsを運用者が確認するまで使わない。
   - adapterは`adapters.ts`に1件ずつ追加できる。
3. 企業の公式採用ページ（任意ドメイン）は、APIからの任意URL取得になりSSRFの面が広がるため、今回は扱わない（後述）。

**選択（semantic resolution）**:
- Jevには、候補の会社名・タイトル・雇用形態と、利用者の入力だけを渡す。URLは渡さない。
- 質問は1つのchoiceで、選択肢は`c1`〜`cN`と`none`だけ。候補にないIDや`none`以外の答えは`none`として扱う。Jevは候補集合の外のURLを作れない。
- Jevを呼ぶのは、機械的に一意に決まらない時だけ（1検索あたり最大1回、候補は`JOB_RESOLVER_MAX_CANDIDATES`件以下）。

**判定基準**（説明できる基準。閾値はdomainの名前付き定数）:
- 候補なし → `not_found`
- タイトルが職種語句をすべて含む候補がちょうど1件 → `resolved`（`single_full_match`、Jevは呼ばない）
- Jevの選択が`min(confidence, p) ≥ 0.8`で、次点の確率 ≤ 0.15 → `resolved`（`confident_selection`）
- それ以外 → 上位3件の`candidates`（Jevの確率順、なければ機械的な順位）。利用者が選ぶ。

`resolved`の場合、Webは表示した求人をそのまま既存の解析へ送る（検索結果1件につき1回）。違う場合はURLの直接入力で指定し直せる。

**UIの位置づけ**: 「おすすめの会社」ではなく、利用者が指定した企業・職種に対応する求人を探す補助である。画面にもそう明記する。

## 設定

`JOB_RESOLVER_MAX_CANDIDATES`（必須、50以下）、`JOB_RESOLVER_ATS_SOURCES`（任意、既定は無効）、`JOB_RESOLVER_FETCH_TIMEOUT_MS`（ATSを有効にする時は必須）、`JEV_API_KEY`＋`JOB_RESOLVER_JEV_TIMEOUT_MS`（任意。なければ機械的な判定だけで、曖昧な時は候補を表示する）。未設定ならAPIは503を返し、URL入力はそのまま使える。

## メリット・デメリット

存在しない求人を指すことがなく、根拠は取得元のデータだけになる。曖昧さは利用者の選択で解消する。一方、初期状態では「このサービスで一度でも解析された企業」しか見つからない。ATS adapterを有効にしても、既存DBにその企業のATS求人がない限り一覧へたどり着けない。検索1回ごとにJev呼び出しが最大1回発生し、利用者ごとの回数制限はまだない。

## 見直し条件

ATSの規約確認が済んだ時（有効化）、公式採用ページの取得をcrawler側の非同期jobで扱う時、検索の悪用やJevのコストが観測された時（回数制限・abuse signalの追加）。
