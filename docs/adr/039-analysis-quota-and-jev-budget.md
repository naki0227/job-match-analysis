# ADR-039: 利用者ごとの新規解析上限とJevの日次予算

## 背景・課題

Issue #42では、取得済み評価の再利用（cache hit）は軽いが、新しいURLの取得とJev判定は費用と取得先への負荷がかかる。IPを共有する環境があるため、主な制限は利用者IDで行う。Jev費用はサービス全体で上限を持ち、上限に達してもサービス全体を止めない必要がある。

## 選択肢

1. APIのメモリ内カウンタで制限する。単純だが、複数プロセスや再起動で数え直しになり、同時要求で上限を超える。
2. DBで数え、受付RPCと同じトランザクションで判定する。同時要求でも超過せず、拒否した要求のジョブも残らない。
3. 外部のrate limiter（Redis等）を入れる。高速だが、MVPに新しい運用部品が増える。

## 決定

2を採用する。

- `request_personal_analysis_limited`は既存の受付RPCを本人のprofile行ロック下で呼ぶ。ジョブが必要だった要求（新規URL・更新が必要なstale）だけ、期間内に同じURLで1件の`user_analysis_quota_events`を追記し、件数が上限を超えたら`P0429`で全体を巻き戻す（ジョブ・依頼行・イベントとも残らない）。freshなcache hitは制限しない。依頼行は後のcache hitで上書きされるため、上限の数え直しに使わず追記専用の表で数える。APIは429 `analysis_quota_exceeded`を返し、Webは解析済みの結果と履歴が引き続き見られることを伝える。
- `reserve_jev_budget`はUTC日ごとの行を更新し、上限内の場合だけ候補数を予約する（全か無か）。Crawlerは`createBudgetedDecisionEngine`でJev呼び出しの前に予約する。予約できない場合はJevを呼ばず、未解決の軸を`unknown`として保存し、評価器版に`jev-budget-exhausted`を含める。決定的なparser・ruleの結果はそのまま使い、その軸を`jev`判定と記録しない。予算ストアの障害は一時エラーとして再試行する。
- 上限値（`ANALYSIS_NEW_URL_LIMIT`、`ANALYSIS_QUOTA_WINDOW_SECONDS`、`CRAWLER_JEV_DAILY_CANDIDATE_BUDGET`）は必須の実行設定とし、既定値をコードに置かない。未設定ならAPIの新規受付は503、workerは起動しない。
- 制限や予算は評価値やMatch判定を変えない。上限による拒否は受付前に起き、予算切れは明示的な`unknown`になる。

## メリット・デメリット

複数のAPI・workerプロセスでも上限を超えず、IP共有の利用者同士が上限を奪い合わない。一方、予算切れの評価も鮮度期間中はcacheとして再利用されるため、予算回復後もすぐには再判定されない。IP・User-Agent・取得失敗率などの監査signalと、cache hit/新規の別メトリクスは観測基盤（#32）と合わせて後続で扱う。

## 見直し条件

上限値の運用が決まった時、予算切れの評価を早く再判定したい要件が出た時、DBのロック待ちが負荷試験（#30）で問題になった時。
