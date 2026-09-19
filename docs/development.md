# 開発運用・手書き実装ガイド

## 開発方針

このリポジトリのプロダクションコードは開発者が自分で手書きする。設計ドキュメントとIssueには「何を保証するか」「どう検証するか」を書き、完成コードの一括生成は開発プロセスの目的に含めない。AIとの相談では、実装前の責務分離・設計理由の解説、実装途中の問題切り分け、差分レビュー、テスト観点の提示を主軸とする。

## Scrum-lite

1週間を1スプリントの目安にする（固定の納期は設けない）。開始時に小さなスプリント目標とその達成に必要なIssueを選び、終了時に動くもののデモ・次の改善を記録する。ボードは Backlog → Ready → In Progress（WIP 1）→ Review/Test → Done。依存が満たされていないIssueはBlockedとして扱う。

**相対優先度の数字を振らない。** 作業順序は「この機能を完成させるための依存関係」とマイルストーンで表す。Epicは複数Issueをまとめる親のチェックリストであり、一度に実装する巨大なIssueではない。

## マイルストーン（機能とインフラは独立）

~~~mermaid
flowchart LR
  spike["M0 Jev/取得/ARM64技術スパイク"]
  domain["M1 診断軸・Matchドメイン"]
  db["M2 DB・認証"]
  queue["M3 URL共有ジョブ"]
  analyzer["M4 Crawler・Jev評価"]
  ui["M5 個人診断UI・相性"]
  quality["M6 品質・ローカルE2E"]
  ops["M7 Terraform/GHCR/k3s/Argo CD/Grafana"]
  spike --> domain --> db --> queue --> analyzer --> ui --> quality
  spike -. "ARM64結果を反映" .-> ops
  quality -. "公開前に接続" .-> ops
~~~

M7はプロダクトのMVPローカル完成を阻害しない独立ストリーム。ただし本番公開する際にはSecurity・Backup・Observabilityの受け入れ条件を満たす必要がある。

## IssueのDefinition of Ready

背景・スコープ、非スコープ、入出力／不変条件、依存関係、受け入れ条件、テスト方法が書かれていること。外部APIや不明仕様が障害なら先に短い技術スパイクを立てること。

## IssueのDefinition of Done

- 設計された成功・異常・競合のケースが動作し、Vitest / DB integration / Playwright等適切な層でテストされている。
- PRの型チェック、lint、テスト、必要なImage buildが通る。
- スキーマ変更にはSQL migration、外部公開仕様変更にはdocs/API契約変更を添える。
- 例外・ログにトークン／個人プロフィール本文が混入せず、個人データの所有者を検査できる。
- 変更理由・未解決のトレードオフを本人が説明でき、必要ならADRへ記録する。

## 想定する実装サイクル

Issueで背景と受け入れ条件を確認 → 相談して実装手順を理解 → 開発者が手書き → tests → PRで差分レビュー → 本人が修正・merge → Issueを閉じる。

CIは成功の証拠だが、診断の妥当性・求人情報の鮮度・規約順守・個人情報の扱いはCI greenだけでは証明されない。
