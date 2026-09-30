# ADR-037: 本人Matchの公開リンクと共有projection

## 背景・課題

Issue #39では、本人向けのMatch結果をX等へ共有し、ログインしていない人もURLで見られるようにする。Matchには希望値・重要度・必須条件・プロフィール版・評価根拠が含まれるため、そのまま公開すると本人の希望年収や勤務地、価値観の細部が漏れる。公開URLは推測されず、本人が止められる必要がある。

## 選択肢

1. 公開時に毎回Matchを読み、公開用に削って返す。保存物は少ないが、匿名の読取が個人データの表へ触れる。
2. 作成時に公開projectionを保存し、公開読取はその行だけを返す。公開経路が個人の表に依存しないが、Matchの再計算は反映されない。
3. 画像だけを生成して配布する。URLの失効ができない。

## 決定

2を採用する。

- 公開してよい内容は`packages/contracts`の`toSharedMatch`/`sharedMatchSchema`だけで定義する。企業名・職種・求人評価日時・8軸それぞれの判定（近い/相違/不明/情報が矛盾/情報が古い/比較対象外）に限り、希望値・評価アンカー値・必須条件・根拠・プロフィール版・利用者IDを含めない。総合点や順位は作らない。サーバー（application層）と画面の共有カード・保存画像・公開ページは同じ関数から作る。
- `match_shares`は作成時のprojection、推測困難なtoken（32バイトのbase64url）、作成・失効日時を持つ。1つのMatchに有効なリンクは1つで、再作成要求は同じURLを返す。失効は行を残して`revoked_at`を記録し、失効後に作ると新しいtokenになる。Matchの削除（本人の退会を含む）で連鎖削除する。
- 操作はservice_role専用RPC（作成・本人の有効リンク読取・失効・token読取）。APIは本人のMatchであることを検証済みIDで確認し、他人のMatchは404。公開読取`GET /api/v1/public/shares/:token`は認証不要で、形式不正・不存在・失効を同じ404にし、`Cache-Control: no-store`と`X-Robots-Tag: noindex`を付ける。
- `/s/<token>`の共有ページとOG画像はAPI（Hono）がserver-renderする（2026年09月30日更新）。HTMLは`GET /s/:token`、画像は`GET /s/:token/og.png`（1200×630のPNG、`satori`→`@resvg/resvg-js`）。どちらも`readPublicShare`経由で保存済みprojectionだけを読み、private表を直接読まない。OGメタ（`og:title`・`og:description`・`og:image`・`twitter:card=summary_large_image`）、`noindex`、`Cache-Control: no-store`で失効を次の要求から反映する。形式不正・不存在・失効は同じ404。React/ViteのSPAはSSRへ移行せず、nginx・Vite開発サーバー・本番のルーティングで`/s/`だけAPIへ送る。共有URLの配信元が異なる場合はWebの`VITE_PUBLIC_SHARE_ORIGIN`、APIの`PUBLIC_SHARE_ORIGIN`・`PUBLIC_APP_URL`で指定する。
- フォントはNoto Sans JP（SIL OFL 1.1）をweight 700に固定し、JIS X 0208とCP932拡張（髙・﨑など）へsubsetした約2.4MBのファイルをAPIのimageに同梱する。ライセンス文書を同じ場所に置き、HTTPでは配信しない。生成手順は`scripts/build-og-font.py`。`@resvg/resvg-js`はlinux x64/arm64（glibc）のバイナリがあり、Azure（amd64）と将来のOCI（arm64）の両方で動く。
- 本人のダイアログでリンクの作成・コピー・失効を行い、Xへの投稿にURLを付けられる。
- tokenは公開データへの鍵であり、平文で保存する（同じURLを再表示するため）。漏えいしても見えるのは公開projectionだけである。

## メリット・デメリット

匿名の読取経路が個人の表を参照せず、公開内容を契約の型で制限できる。失効はDB更新で即時に効く。一方、共有後にMatchの表示ロジックや会社評価が変わっても公開内容は作成時のまま。OG画像は要求ごとに描画する（no-storeのため）ので、APIのCPUを使う。公開読取のrate limitは#42、利用規約上の扱いは#29で確認する。

## 見直し条件

OG画像の描画負荷が無料枠を圧迫した時は、失効を即時に反映できる範囲でのcacheを検討する。共有の閲覧数や期限付きリンクが必要になった場合は表を拡張する。
