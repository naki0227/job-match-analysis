# ADR-032: 本人のMatchを作成・保存・参照するAPI

## 背景・課題

共有解析（ADR-030）は評価IDまでしか返さず、Web結果画面（ADR-031）に表示する本人の軸別比較を返す経路がなかった。`match_results`系の表（Issue #14）と分析履歴RPC（ADR-023）はあるが、保存RPC、HTTP、ユースケース層がない。Workerは解析の依頼者を知らない（ADR-030）ため、サーバー側で依頼者全員のMatchを作れない。

## 選択肢

1. Webが解析完了後に`POST /matches {evaluationId}`を呼び、APIが本人の最新プロフィール版と比較して保存する。保存・再送の整合をDBで保証できる。
2. 取得時に毎回計算し、保存しない。実装は軽いが、ADR-023の分析履歴（Match行が元）が作られない。
3. Workerの完了時にMatchを作る。依頼者対応表と個人情報の扱いをWorkerへ持ち込むことになる。

## 決定

1を採用する。

Issue #27で、Webが完了画面まで到達しない場合の補完経路を[ADR-033](033-analysis-history-delivery.md)に追加した。通常のPOSTと再訪時の補完はいずれも同じ`createMatch`ユースケースを使う。

- `packages/application`を新設し、`createMatch`/`readMatch`ユースケースとport（本人プロフィール、共有評価、Match保存）を置く。比較はdomainの`matchCareerProfile`、HTTP形状は`packages/contracts`の`matchReportSchema`。API routeは認証・入力検証・ユースケース呼び出し・状態コードだけを担う。
- `POST /api/v1/matches {evaluationId}`: 本人の最新確定プロフィール版と求人評価を比較し、新規は201、同じ（プロフィール版・評価・アルゴリズム版）の既存Matchは200で返す。プロフィール未保存409、評価なし404、会社評価または軸版不一致422。クライアントからuserIdやプロフィールは受け取らない。
- `GET /api/v1/me/matches/:matchResultId`: 本人のMatchだけを返し、他人・不在は404。求人の軸結果は保存時のsnapshot、会社全体は最新の会社評価と保存済み希望値から再計算する（ADR-023と同じく会社評価は保存しない）。
- `commit_match_result` RPCは本人のcompletedプロフィール版と求人評価を検査し、送られた軸snapshotが保存済みの希望値・評価値と一致しない場合は拒否する。Match・軸・必須条件を1回で保存し、既存の一意制約で再送・同時実行を1行にまとめる。読取は`read_evaluation_for_match`/`read_match_result`の各1往復。いずれもservice_role専用。
- 本人プロフィールの読取は既存どおり本人JWTとRLSで行う。
- `domain`パッケージはNode.js組込みの`domain`モジュールと名前が衝突するため`@job-match/domain`へ改名した。
- アルゴリズム版は`match-engine-v1`。比較規則を変えたら版を上げ、旧Matchは残す。

## メリット・デメリット

分析完了と同時に履歴の元になるMatchが残り、過去のプロフィール版・評価版を再現できる。DBが本人所有・求人評価・snapshot一致を検査するため、API実装の誤りで他人のプロフィールや矛盾したsnapshotが保存されない。一方、POSTは表示のたびに呼ばれ得る（既存行を返すだけで重複は作らない）。求人条件（給与・勤務地・リモート）の保存先がまだないため、必須条件は現在すべて`unknown(missing_information)`または`not_required`になる。CrawlerのURL→会社/求人の解決が未接続のため、実データでのMatchはworker接続後に確認する。

## 見直し条件

求人条件の抽出・保存を追加したら、`read_evaluation_for_match`とportへ条件を加える。プロフィール更新後に古い版のMatchを自動で作り直す要件、会社評価の版も固定表示する要件、POST頻度が問題になった場合は再検討する。
