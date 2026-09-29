# ADR-025: DB leaseとworker tokenで解析ジョブを引き継ぐ

## 背景と課題

Issue #20はworkerの多重起動・停止時にも共有解析を失わず、古いworkerが結果を二重確定しないことを求める。既存の`analysis_jobs`には`attempts`、`lease_until`、`worker_token`があり、`commit_analysis_evaluation`はstatusとtokenを検証する。claimと期限切れ回収は未実装だった。

## 選択肢

- PostgreSQLの`FOR UPDATE SKIP LOCKED`でclaimし、期限切れを再キュー化する。既存DBジョブ管理と一体で、外部Queueは不要。lease期限と再試行の管理が必要。
- workerごとにジョブをポーリングしてアプリ内ロックする。実装は短いが、多重起動・停止時の所有権を保証しにくい。
- 外部Queueを導入する。専用の再配信機構があるが、追加サービスと二重書込みが必要。

## 決定

service_role専用RPCで期限切れrunning jobを回収し、試行上限未満ならqueuedに戻す。上限に達したjobはfailedにする。claimは`FOR UPDATE SKIP LOCKED`でqueuedを1件選び、同じ操作で`running`、`attempts+1`、新しいworker token、lease期限を確定する。lease更新と恒久失敗の確定もtokenと有効期限を検証する。`commit_analysis_evaluation`の既存token検査に加え、triggerで期限切れleaseからcompletedへの変更を拒否する。

Crawlerのconsumerはclaim→取得・評価処理→既存の原子的評価確定RPCを呼ぶ。処理関数は長時間作業中に渡されたrenewを呼べる。一時失敗ではjobをrunningのまま残し、lease満了後に回収する。恒久失敗ではtoken付きRPCでfailedにする。processorの具体的な取得・評価実装はIssue #21/#22。lease秒数と最大試行数は実行側から渡し、ここでは本番の頻度・外部API予算を固定しない。

## 利点・欠点

worker停止後もDBにjobが残り、次のclaimで引き継げる。古いtokenの完了を拒否できる。一時障害の次回実行はlease期限後になるため、leaseが長すぎると回復が遅い。処理中のlease更新が不足すると重複実行があり得る。外部サイト/Jevの呼出し自体はexactly-onceではなく、結果確定だけを冪等にする。

## 見直し条件

本番の処理時間・エラー率・外部API費用を測り、lease長・試行上限・backoffの運用値を決める。明示的な次回実行時刻が必要なら専用列を追加して再設計する。外部Queue導入が必要な規模になればoutboxを検討する。
