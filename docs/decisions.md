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

## 技術スパイクで検証すべき仮説

1. Jev Early Accessの利用可能性、実APIの認証・入出力・並列決定・料金・制約は未検証。モデルが返す数値を「企業の裁量90/100」と直接解釈してよい根拠はない。実測とルーブリック策定までは総合%を表示しない。
2. 公開企業ページはHTTPだけでは不足する可能性がある。静的HTML/JS描画各1例で本文抽出品質と規約を確かめる。取得した企業本文は未信頼データとして扱う。
3. OCI Always Free VMのARM64ブラウザ・Argo CD・k3sを同居させた時のCPU・RAM・起動時間・無料枠の現状は実測前。運用環境が確保できなくてもlocal開発を進められるようにする。
4. Postgresジョブ管理の同時実行・終了直後のrace・lease更新・可視性・低頻度ポーリングを統合テストする。
5. 企業URLの正規化と同一企業／求人へのalias統合は別の問題。URL queryから求人ID等を機械的に削除しない。
6. 本人の回答は自己申告であり、人格の「正解」や企業への「適性」を客観的に測定できたと表現しない。Job情報が不足するときはunknown。

## 明示的に未確定

- 診断軸の質問文・両極の尺度・重要度0の意味・Hard Constraintの適用ルール。
- rubric_version / evaluator_version / score→表示値の変換・総合点を出す妥当性。
- Supabase無料枠におけるバックアップ実装と復元訓練、保持期間、個人データ削除経路。
- crawlerのfetch policy、利用規約、robots、無料枠を超えないジョブ上限、proxy/ブラウザのネットワークレベルSSRF防御。
- AWS等への移行条件、実際のSLO、service名（現状はjob-match-analysis仮称）。
- jobId閲覧権限、求人別と会社別の評価継承、出典抽出の引用長と二次利用規約。
- 正式なAPI prefix（/api か /api/v1）とZod契約。

未確定項目を確定事項としてコードに埋め込まない。各Issueの実験・レビュー結果をここにADRとして追記する。
