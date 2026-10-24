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
- Jevの予算設定は正の整数（有限）か明示的な`unlimited`だけを受け付ける。0・負数・大きな数値を無制限の意味に使わない。`unlimited`では予算表を参照せず、予算理由で`unknown`へ落とさない。有限モードの予約・同時実行の保証と予算表は将来の切り替えのために残す。Jev呼び出しの候補数・input/output token・成功/失敗は、vendor非依存のmetrics port（`CrawlerMetrics`）から計測する（#32でOpenTelemetryへ接続）。

## 初期の運用値（2026年09月30日、ユーザー決定）

リリース初動は解析品質を優先する。正規ユーザーの解析品質をJev予算で落とさず、botや大量URL要求は利用者ごとの上限で防ぐ。

| 設定 | 値 | 意味 |
|---|---|---|
| `ANALYSIS_NEW_URL_LIMIT` | `10` | 1利用者あたり、期間内に新規・更新が必要なURLは10件まで |
| `ANALYSIS_QUOTA_WINDOW_SECONDS` | `86400` | 期間は24時間 |
| `CRAWLER_JEV_DAILY_CANDIDATE_BUDGET` | `unlimited` | Jevの日次予算で制限しない |
| `ANALYSIS_REQUEST_LIMIT` | `120`（2026年10月20日追加、提案値） | 1利用者あたり、期間内の解析要求はcache hitを含めて120件まで |
| `ANALYSIS_REQUEST_WINDOW_SECONDS` | `3600`（同上） | 期間は1時間（最大1日） |

これらは運用設定であり、ドメイン規則ではない。実測後に有限の予算へ戻せる。
- 制限や予算は評価値やMatch判定を変えない。上限による拒否は受付前に起き、予算切れは明示的な`unknown`になる。

## 追記: cache hitを含む全要求の上限（2026年10月20日、Issue #42）

- cache hitは安いが無制限ではない。DBの読み取りとMatch作成を大量に繰り返す自動化を防ぐため、新規解析の厳しい上限とは別に、すべての解析要求（cache hit・新規・stale・不正なURL）を数える緩い上限を置く。
- `consume_analysis_request_allowance(user, since, limit)`は本人単位のadvisory lock下で期間内の`user_analysis_request_events`を数え、上限内なら1件を追記して`true`を返す。期間は1日以内に限り、1日より古い行はその利用者の次の要求で消す。
- APIは認証直後、本文の検証より前に確認する。超過したら429 `analysis_rate_limited`（新規解析の`analysis_quota_exceeded`とは別のcode）。確認できなければ503（fail closed）。
- metricは`job_match.analysis.requests{outcome}`に`rate_limited`を加える。cache hit（`fresh`）・新規（`queued`・`stale`）・新規上限の拒否（`quota_rejected`）・全要求上限の拒否（`rate_limited`）は、すでに別のoutcomeとして数えている。
- 上限値は必須設定。上の`120件/1時間`は通常の閲覧では届かない値として提案したもので、運用値はユーザーが決める。

## メリット・デメリット

複数のAPI・workerプロセスでも上限を超えず、IP共有の利用者同士が上限を奪い合わない。一方、予算切れの評価も鮮度期間中はcacheとして再利用されるため、予算回復後もすぐには再判定されない。監査signalはADR-042の追記を参照。

## 見直し条件

上限値の運用が決まった時、予算切れの評価を早く再判定したい要件が出た時、DBのロック待ちが負荷試験（#30）で問題になった時。
