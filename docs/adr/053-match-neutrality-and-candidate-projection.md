# ADR-053: 企業提携時のMatch中立性と匿名Candidate Projectionの境界

> 状態: 決定（2026年10月20日）。Issue #44。企業向け機能はまだ実装しない。このADRは、将来の提携・スカウト・匿名集計を追加する前に、越えてはならない境界を固定する。

## 背景・課題

将来、企業との提携、掲載料、スカウト、匿名プロフィールの公開を検討する可能性がある。商業関係が本人向けのMatch判定に混ざると、本人の比較・意思決定支援（ADR-008）という前提が崩れる。また、個人のCareerProfileを企業向けAPIからそのまま読める設計にすると、本人が許可していない情報が企業へ渡る。後から境界を引き直すのは難しいため、企業向け機能を作る前に不変条件と依存の方向を決めておく。

## 決定

### 不変条件

1. partnership・sponsorship・掲載料・広告枠・提携先IDなどの商業metadataを、MatchEngine（`packages/domain`の`matchCareerProfile`）の入力にしない。
2. 提携の有無で、軸の`close`／`different`／`partial`／`unknown`（`conflicting`・`stale`を含む）や、Hard Constraintの`met`／`unmet`／`unknown`を変えない。表示順・強調・件数の上限にも使わない。提携を表示する場合は、Match結果とは別の「提携」表示として明示する。
3. 企業向けAPIや企業向けroleから、`profiles`・`career_profile_*`・`profile_educations`・`match_results`などの個人の生テーブルを直接SELECTさせない。
4. 将来の企業向け情報は、private source of truthから本人が公開を許可した項目だけを、一方向のcandidate projectionへ投影して作る。projectionから個人の生テーブルへ書き戻さない。
5. 次の3つは別々のopt-inとする。どれか1つへの同意が、ほかの同意を含意しない。
   - 匿名プロフィールの公開
   - スカウトの受信
   - 特定企業へのidentity reveal（氏名・メール等の開示）
6. identity revealは、organization単位で記録し、撤回できる。同意の履歴は、目的・版付きの追記履歴として持つ（analytics consentと同じ考え方）。撤回後は、新しく開示しない。
7. identity revealの前は、氏名・メール・電話・学籍番号・認証プロバイダのIDを、企業向けprojectionへ出さない。

### 依存の方向（sponsor metadataをMatch計算から参照できないこと）

- `packages/domain`は外部packageもDBも参照しない純粋計算で（依存なし、Node型も持たない）、`MatchInput`は本人のCareerProfile版と公開評価（求人・会社）だけで構成される。
- `packages/application`の`match-use-cases`は、保存済みのCareerProfile版と評価版からMatchInputを組み立てる。将来の`organizations`やpartner系の表を、この組み立てに参照させない。
- partner情報が必要な画面は、Match結果を受け取った後のpresentation層で、別のデータとして結合する。

~~~mermaid
flowchart LR
  subgraph private["Private source of truth（本人だけ・RLS）"]
    P[profiles / career_profile_* / profile_educations]
    M[match_results]
  end
  subgraph shared["公開情報（共有評価）"]
    E[evaluations / evaluated_axis_values]
  end
  D["packages/domain matchCareerProfile（純粋計算）"]
  P --> D
  E --> D
  D --> M
  C{{"本人の別々のopt-in<br/>匿名公開 / スカウト受信 / org単位のidentity reveal"}}
  P -- 許可された項目だけ・一方向 --> C --> CP["将来: candidate projection（企業向け）"]
  CP -. 書き戻し・参照なし .-> P
  S["将来: organizations / partner metadata"] -. Match入力にしない .-> D
  S --> UI["presentation層で別表示"]
~~~

### 同意の境界（企業向け集計と個人単位スカウト）

- 企業向けの匿名集計は、`external_aggregate_use`の目的として扱う（Issue #40）。対象は閾値以上のcohortの集計だけで、個人単位の行は企業へ出さない。
- 個人単位のスカウトは、匿名プロフィールの公開とスカウト受信のopt-inを持つ本人だけを対象にする。集計への同意から、スカウトの同意を導かない。

### 作らないもの

`candidate_profiles`・`organizations`・scout系の表やAPIは、企業向け機能を実装すると決めるまで作らない。作る時は、このADRの不変条件をmigrationとテストで強制する。

## トレードオフ

- 提携による優先表示や「おすすめ」による収益化はできない。提携の価値は、Match結果と分けた表示に限られる。
- candidate projectionは、private sourceからの投影と、撤回時の再投影が必要になる。直接参照より実装量が増える。

## 検証

- 現在: `packages/domain/tests/match-neutrality.test.ts`で次を確かめる。
  - partnership・sponsorship等のmetadataを入力に付けても、同じ入力のMatch結果（`close`・`different`・`unknown`・Hard Constraintの衝突を含む）が変わらない。
- 企業向け機能を実装する時は、次を追加する。
  - partner flagの有無で、同一のMatch入力の結果が変わらないことを、application層とAPIのcontract testで確かめる。
  - 企業向けroleが個人の生テーブルを読めないことを、DBの権限テストで確かめる（`issue29_security.sql`の許可リストを拡張する）。
  - identity revealの前は、氏名・メールが企業向けprojectionへ出ないことを、受け入れ条件とテストに含める。
  - 撤回後は、新しい開示も投影もしないことをテストする。

## 見直し条件

企業向け機能（提携・スカウト・匿名プロフィール）の実装を決めた時。法務・プライバシーポリシーの改定で開示の要件が変わった時。
