# ADR-031: Web画面の構成・解析ジョブ状態・結果表示の境界

## 背景・課題

Issue #26でログイン後の画面を`apps/web/mock/job_match_release_mock.html`に合わせ、求人URLの受付と共有ジョブの状態表示を実装する。一方、本人の希望と共有評価を比較するMatch APIと評価詳細APIは未定義で、分析履歴のHTTP公開は#27で扱う。画面の分け方、サーバー状態の扱い、未提供APIの境界を決める必要がある。

## 選択肢

1. ルーター・TanStack Queryを導入し、結果画面もAPI契約を先に仮定して実装する。URL共有や再読込には強いが、依存と未確定契約をまとめて固定する。
2. 画面切替はReact state、ポーリングは専用hookで実装し、結果表示はWeb側のview modelとfixtureで検証する。依存を増やさずに済むが、URLで画面を復元できず、Match APIの接続作業が残る。
3. 結果表示をAPIができるまで作らない。未確定部分はないが、#26の根拠・出典・文言の受け入れ条件をUIで検証できない。

## 決定

2を採用する。

- `src/features/<機能>`に画面・hook・APIクライアントを置き、共通の見た目は`src/components`、全体の色と文字は`src/index.css`のトークンに置く。ホーム・求人分析・希望条件の3画面を`AuthenticatedApp`のstateで切り替える。
- 解析状態は純粋関数`analysis-state.ts`で`ready`（cache hit / job完了）、`stale`（旧評価＋更新ジョブ）、`waiting`（queued/running）、`failed`、`timeout`、`error`に分ける。`useAnalysisRequest`は2秒から最大10秒間隔で共有ジョブを読み、503・通信断は期限まで再試行し、180秒で`timeout`にする。timeoutは共有ジョブの失敗とは表示しない。
- stale時は旧評価の取得日時を示したまま更新ジョブを追い、更新が失敗しても旧評価を消さない。
- 結果表示`MatchReport`はdomainの`MatchResult`に対応するWeb側view modelを受け取り、求人固有と会社全体（参考）を別セクションにし、根拠の引用・出典URL・取得日時、根拠なし、重要度0、版不一致、必須条件を表示する。総合％や採否・適性の表現は使わない。出典URLはhttp(s)だけをリンクにする。
- 完了した解析画面には、比較結果APIの接続後に軸別比較を表示すると明示し、架空の結果を出さない。
- マスコットは装飾画像（`alt=""`）とし、状態の意味は文章で伝える。フォントはモックと同じGoogle Fonts（Zen Kaku Gothic New / Zen Maru Gothic、`display=swap`）を読み込み、取得できない場合は端末の日本語フォントへフォールバックする。閲覧時にGoogleへIPアドレス等が送られるため、プライバシーポリシーに記載する。

## メリット・デメリット

依存を増やさずに受付・ポーリング・表示の状態を単体テストでき、未定義のAPI契約を`packages/contracts`へ固定しない。反面、画面はURLから復元できず、再読込すると進行中のジョブ表示は消える（共有ジョブ自体は続き、同じURLの再送で同じジョブに参加する）。view modelとAPI契約の対応付けは接続時に必要になる。

## 見直し条件

結果詳細・分析履歴など、URLで開き直す画面やキャッシュを共有するサーバー状態が増えた時点で、ルーターとTanStack Queryの導入を再検討する。Match APIの契約が決まったら`packages/contracts`に移し、view modelへの変換とテストを追加する。
