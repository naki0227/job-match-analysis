# ADR-043: Analytics consentとanalytics schema（Product / Business Analytics）

> 状態: 決定（2026年10月20日）。Issue #40・#41。ADR-041（運用観測）とADR-046（利用規約・プライバシーポリシーの確認）とは別の目的と経路として扱う。

## 背景・課題

就活市場の匿名集計（Community Insights）や利用状況をGrafanaで見たい。一方、Grafanaへ`profiles`やCareerProfileの生テーブルを自由にSELECTさせると、少人数の属性組み合わせから個人を特定できる。属性を少しずつ変えて複数のcohortを比べれば、特定はさらに容易になる。同意も、単一のbooleanでは「いつ、どの説明の版に、どの目的で」同意・撤回したかを示せない。

## 決定

### 同意（#40）

- 目的（purpose）は`community_benchmark`（本人向けを含むサービス内の匿名比較・集計）と`external_aggregate_use`（外部・企業向けの集計提供）の2つ。どちらも任意で、同意しなくても本体サービスは使える。
- `analytics_consent_policies`は目的ごとの説明を版付きで持つ（`version`・`summary`・`effective_at`）。`analytics_consent_events`は本人の`granted`／`withdrawn`の履歴で、追記だけを行う（更新・削除しない。退会時だけCASCADEで消える）。
- **有効な同意**: 目的ごとに、本人の最新の決定が「その時点で現在の版」への`granted`である場合だけ。撤回した後や新しい版が適用された後は、次に計算する集計から外れる。過去の版への同意は数えない（再同意が必要）。
- 記録はサーバー専用RPC`record_analytics_consent(user, policy, action)`だけで行う。現在の版以外は409相当（`P0409`）。同じ決定の再送や、同意していない状態での撤回は何もしない。状態は`analytics_consent_status(user)`で返す。クライアントロールにはどちらの表の権限もない。
- 版が変わった時に再同意を求めるかどうかは画面側で判断する。同意画面（API・Web）は別PRで追加する。本ADRではDBの境界だけを決める。

### analytics schemaとGrafana（#41）

- 生データ（`public`）と集計（`analytics`）を分ける。`analytics`には集計viewだけを置き、利用者ID・プロフィールの自由記述・URL・共有tokenを列に持たない。
- 同意集合は`analytics_private`のview（`current_policies`・`consented_users`）として持つ。このschemaにはどのroleにも権限を与えない。関数にしなかったのは、viewから呼んだ関数は呼び出し側の権限で実行されるため、Grafana用roleへ利用者IDを返す関数の実行権限を渡す必要が出るからである。viewの中で参照する表やviewは、view所有者の権限で読まれる。
- `analytics_reader`はNOLOGIN・NOINHERITのroleで、`analytics`のUSAGEとviewのSELECTだけを持つ。Grafana用のlogin userは、所有者がmigrationの外で作成し、このroleを付与する（手順は下記）。ad-hocな分析も、原則同じread-only経路で行う。admin APIやadmin consoleは作らない。
- **同意が要らない集計**: 属性を持たない利用件数と、共有の公開企業評価の品質だけ。具体的には`daily_active_users`、`analysis_usage_daily`、`consent_rate`、`unknown_rate_daily`、`evaluator_method_daily`、`external_api_cost_daily`。
- **同意が要る集計**（`community_benchmark`に有効な同意をした利用者だけで計算し、cohortごとに閾値を適用する）:
  - `company_interest_daily`: 日別・企業別の閲覧人数。閾値未満の企業は返さない。
  - `cohort_axis_distribution`: 卒業年度・軸ごとの希望値と重要度の平均。
- **cohortは導出のみ**: 利用者に検索させず、卒業年度（本人の学歴の`ended_on`の最大年）だけで決める。大学・学部・希望職種を組み合わせたAND検索は提供しない。プロフィールは本人の最新の`completed`版（`career_profile_versions`）を使い、`axis_catalog_version`を列に持つ。
- **閾値**: `analytics.min_cohort_size()` = 10（内部のGrafana向け）。閾値未満のcohortは行ごと返さない。差分から推測されないよう、cohort系viewの横に全体合計を出さない。外部向け（`external_aggregate_use`）はより厳しい閾値にする。人数は実データとリスク評価の後に決め、外部提供を始めるまでは`external_aggregate_use`の集計viewを作らない。

### 脅威モデル（属性変更による探索）

- 本人が学歴を何度も変えて、複数のcohortの差分から他人の値を推測する攻撃が考えられる。対策は次のとおり。
  - cohortを粗い卒業年度だけにする。
  - 閾値未満のcohortを返さない。
  - 集計はGrafanaの内部閲覧に限り、利用者へは出さない。
- 将来、本人向けにInsightを出す時は、上の対策に加えて次を行う。
  - 同意時点の版でcohortを固定する。
  - 属性変更の回数を制限する。
  - 結果を丸める（またはノイズを加える）。
- `profile_educations.verification_status`（`self_reported`／`verified`）は既にある。外部向けの集計は`verified`の利用者だけに絞れるようにする。現在のviewは`self_reported`を含む内部用である。

### 運用

- Grafanaのlogin userは所有者がSQL editorで作る。パスワードはGrafanaのdatasource secretにだけ置く。
  ~~~sql
  create role grafana_analytics login password '<secret>' in role analytics_reader;
  ~~~
  login userは既定のINHERITで`analytics_reader`の権限だけを持つ。他のroleを付与しない。
- Grafana PostgreSQL datasourceはSupavisor（session mode）経由で接続する。user名は`grafana_analytics.<project-ref>`、`sslmode=require`。dashboardは`infra/grafana/dashboards/product-analytics/`に置く。
- 集計はviewのまま毎回計算する。MVPの規模（perf seed 1,122 Match）では、各viewは1〜10ms以内だった（EXPLAIN ANALYZE）。日別集計が重くなったらmaterialized viewと日次refreshへ移す。

## 検証

`supabase/tests/20261020120000_analytics_consent_schema.sql`（`pnpm test:db`）で次を確かめる。

- 同意していない利用者が集計に入らない。
- 撤回後や版の更新後は、次の集計から外れる。
- 閾値未満のcohortは返らない。
- 退会すると、すべての集計から消える（#29）。
- 古い版への同意は拒否される。
- `analytics_reader`は`public`の表、`analytics_private`、同意RPCを使えず、他roleのmemberでもない。
- `anon`・`authenticated`・`service_role`は`analytics`のviewを読めない。

## 見直し条件

外部提供を始める時、本人向けInsightを出す時、利用者数が増えてviewが遅くなった時、法務の判断で目的・説明文を変える時。
