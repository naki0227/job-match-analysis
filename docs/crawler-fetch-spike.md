# #9 HTTP取得とJS描画の比較

2026-09-28に、取得を許可された[Scraping Sandbox](https://sites.toscrape.com/)の[静的ページ](https://quotes.toscrape.com/)と[JS描画ページ](https://quotes.toscrape.com/js/)を各1回ずつ比較した。これは取得方式の検証であり、求人サイトへのアクセス試験ではない。求人本文の判定はローカルの合成fixtureで検証した。外部本文はリポジトリに保存しない。

| 対象 | HTTP応答 | HTTP本文 | HTTPで見える項目 | HTTP時間 | ブラウザで見える項目 | ブラウザ時間 | ブラウザ要求 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 静的 | 200 | 11,064 B | 10 | 688 ms | 10 | 1,756 ms | 5件（HTML、CSS 3、font 1） |
| JS描画 | 200 | 5,808 B | 0 | 296 ms | 10 | 1,824 ms | 6件（HTML、CSS 3、JS 1、font 1） |

単発の開発環境測定であり、性能保証値ではない。Playwrightの`networkidle`までを計測し、ブラウザのrequestイベントでサブリソースも数えた。HTMLのバイト数はHTTPレスポンス本文のUTF-8サイズ。当時のローカルfixtureとスパイクテストはcommit `56655e5` に残す。現行のブラウザ通信境界の自動テストは `apps/crawler/tests/browser-boundary.test.ts` で実行し、HTTP→ブラウザの本実装は#21でテストする。WebのPlaywright E2EはUI導線だけを扱う。

## 本文不足と上限

- 抽出対象の`article[data-job]`がない、または空白を除いた本文が100文字未満なら不足としてPlaywrightを**最大1回**起動する。ブラウザでも100文字未満なら「情報不足」とする。100文字はfixtureの成功・不足を観測するための暫定値で、一般的な求人抽出精度は#21で検証する。
- HTTP応答はストリームで最大1 MiBまで読み、それを超えたら中止する。HTTP非成功や取得失敗でもブラウザで回避しない。fixtureでは503を検証した。
- このスパイクではHTTP取得を5秒、ブラウザnavigationを10秒、本文出現待ちを5秒に制限する。これらは実測上限の候補で、運用時の同時実行・コスト上限は別途検証する。
- 上記は**スパイク専用コード**である。任意URLの取得とブラウザの全リクエストに対するSSRF防御・egress制限が整うまで、本番Crawlerには接続しない（#18）。

## 公開情報の取得方針

- 取得対象は公開HTTPSページとし、対象パスをrobotsが許可した場合に取得する。サイト別の手動承認は必須にしない。ログイン、paywall、アクセス制限、CAPTCHAは回避しない。詳細は[ADR-034](adr/034-public-crawl-eligibility.md)に従う。
- 今回の練習サイトは運営者がスクレイピング演習用と明記している。`robots.txt`は2026-09-28時点で404だった。現行実装では対象originのrobotsが404または410ならルールなしとして扱い、他のoriginにはその結果を流用しない。
- robots取得が5xxまたは失敗した場合は取得を保留する。RFC 9309のunreachable時に完全拒否として扱う考え方に合わせる。取得ペース、引用・保存範囲は運用前に確定する。

参照: [Scraping Sandbox](https://sites.toscrape.com/)、[Playwright Network](https://playwright.dev/docs/network)、[RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html)。

## #21 実装への反映

`apps/crawler/src/fetch-source-document.ts`は、HTTP本文が100非空白文字に満たない場合だけ既存の安全なPlaywright境界を1回使う。本文抽出は`source-extractor.ts`の`html-v1`で求人と明示された会社領域を区別し、正規化本文のSHA-256、取得日時、DOM位置を返す。`crawl-policy.ts`はrobotsを確認し、redirectとブラウザ要求にも同じ判定を適用する。サイト別の追加遮断は呼び出し側で指定できる。判断の理由と制約は[ADR-026](adr/026-crawler-source-extraction.md)と[ADR-034](adr/034-public-crawl-eligibility.md)を参照。

スパイク当時はfixtureだけで検証した。その後、評価との原子的なDB保存と30日後の本文削除処理はworkerへ接続した。実サイトでの抽出精度、取得頻度、引用範囲は運用前に確認する。
