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
| ADR-009 | Jev APIはAPIサーバーから直接HTTPで呼び出し、Zodでレスポンス契約を検証する | TypeScriptから利用可能で、実APIによるNoul / Choice / Scoreの入出力を確認できた。外部APIの契約違反をアプリ内部へ漏らさない | Jev固有のschema・error mapping・timeout/429処理を保守する必要がある |
| [ADR-010](adr/010-assessment-axes.md) | MVPの就業価値観は8軸で定義する | 本人の希望を分けて表し、各軸を公開資料の根拠で確認する | 入力負担と `unknown` が増える |
| [ADR-011](adr/011-importance-and-hard-constraints.md) | 重要度0は比較から除外し、必須条件は個別求人の明示情報で判定する | 未回答と区別し、根拠のない推定を避ける | 判定不能の `unknown` が増える |
| [ADR-012](adr/012-domain-identifiers.md) | CareerProfileは固定の8軸ID・共通カタログ版と2桁の都道府県コードを使う | 版混在と表記揺れをドメイン境界で拒否する | 軸変更時は全体を新版にし、市区町村・海外は別途拡張が必要 |
| [ADR-013](adr/013-match-engine-policy.md) | 軸ごとの0/50/100アンカーを比較し、求人と会社の結果を分離する | 総合％に頼らず根拠と相違を示す | 境界値と情報不足の扱いを検証し続ける必要がある |
| [ADR-014](adr/014-postgresql-physical-schema.md) | UUID・複合FKを中心に物理DDLを定義し、RLSを先に有効化する | 個人/共有/出典の整合性をDBで保証する | 本文30日削除は予定済みworker接続まで自動化されない |
| [ADR-015](adr/015-target-roles-in-career-profile.md) | 希望職種をCareerProfile版の必須リストとして保持する | 再評価時にも当時の希望を追える | 職種の正規化と自動一致は別途決める |
| [ADR-016](adr/016-google-auth-and-personal-read-rls.md) | Google OAuth、APIでのprofile初期化、本人参照のみのRLS | 個人データを所有者に限定し、変更をAPIへ集約する | Google provider設定の実ログイン検証が必要 |
| [ADR-017](adr/017-atomic-profile-and-evaluation-commits.md) | プロフィールと評価をそれぞれ1回のRPCで原子的に確定する | 部分確定と再送時の重複を防ぐ | サーバーとDB関数の入力契約を合わせる |
| [ADR-018](adr/018-saved-jobs-batch-pagination.md) | 保存済み求人一覧は1回のRPCとkeyset cursorで読む | DB往復のN+1を防ぐ | 一覧列の変更時はRPCとrepositoryの両方を更新する |

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
- rubric_version / evaluator_version / score→表示値の変換・総合点を出す妥当性。
    - Jev Score は rubric level に対する確率加重期待値であり、0〜100 のユーザー嗜好度・企業適合率とは直接対応しない。
    アプリ側で適合率へ変換する場合は、Jev Score とは別の明示的な正規化ルールを設計する。
- Supabase無料枠におけるバックアップ実装と復元訓練、個人データ削除要求の実行経路、評価根拠の保持期間。抽出本文は取得から30日後に削除する方針だが、workerへの接続は未実装。
- crawlerのfetch policy、利用規約、robots、無料枠を超えないジョブ上限、proxy/ブラウザのネットワークレベルSSRF防御。
- AWS等への移行条件、実際のSLO、service名（現状はjob-match-analysis仮称）。
- jobId閲覧権限、求人別と会社別の評価継承、出典抽出の引用長と二次利用規約。
- 正式なAPI prefix（/api か /api/v1）とZod契約。

未確定項目を確定事項としてコードに埋め込まない。各Issueの実験・レビュー結果をここにADRとして追記する。
