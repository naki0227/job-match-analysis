# ADR-021: 公開URLの取得は接続時に宛先IPを検査・固定する

## 背景・課題

ユーザー入力URLを通常の`fetch`へ渡すと、事前のDNS確認後に接続先が変わる可能性がある。ブラウザはHTML以外にもJS・画像・XHR・WebSocketを発行する。内部ネットワークやクラウドメタデータへの到達をアプリ層で拒否する必要がある。

## 選択肢

1. URLだけ事前検査して標準`fetch`/Playwrightへ渡す。実装は短いがDNS切替とブラウザの別要求を取りこぼす。
2. NodeのHTTPS接続時にDNS全回答を確認し、選んだ公開IPをその接続に固定する。リダイレクトは手動検査。ブラウザのHTTP(S)要求は全てこの取得境界で中継し、WebSocketは拒否する。

## 採用

2。`apps/crawler`に独立実装する。HTTPS/443のみ、認証情報付きURL禁止、URL 2048文字、リダイレクト3回、応答1 MiB、取得全体10秒。ブラウザでは1ページ32要求・総計8 MiB。DNSのA/AAAA回答が一つでも非公開なら拒否し、接続時に選んだIPを`https.request`の`lookup` callbackへ返す。IP literalも同じ判定を行う。Chromiumへ3xxを渡さず、Node側で検査・追跡する。Service Workerを止め、WebSocketを拒否する。

IPの非公開範囲は2026-09-28時点の[IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry)・[IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry)の特別用途範囲を保守的に反映した。新しい特別用途範囲の追加時はリストとテストを見直す。

## 利点・欠点

接続時のIP固定でDNS rebindを防ぎ、直接URL・redirect・サブリソースを同じポリシーに通せる。一方、HTTPS以外、非443ポート、圧縮応答、大きなページなどは取得できない。ブラウザ内の相対URLは、Node側でredirectを追った後でも元のURLを基準に解決され得るため、#21の抽出時に最終URLの扱いを確認する。

## 見直し条件・残る境界

本番Crawlerに接続する前に、ブラウザプロセス自身の外向き通信をネットワーク層でも制限する。PlaywrightのroutingだけでDNS prefetchやWebRTC等まで完全に遮断したと主張しない。k3sのegress方針と実環境での拒否検証は#36で扱う。対応サイトで上記制限が過度に失敗する場合は、実測と安全性を確認して閾値を変更する。利用規約・robots・取得頻度のサイト別判定は別の取得ポリシーとして残る。

2026-09-29に公開の[Scraping Sandbox](https://sites.toscrape.com/)で実ブラウザの互換性を確認した。取得境界経由で静的版・JS版とも表示項目10件、ブラウザ要求はそれぞれ6件・7件、合計応答バイトは237,828 B・316,917 B、ブロック0件だった。これは通常の公開ページが読めることの確認であり、ネットワーク層の遮断を証明しない。

参照: [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)、[Playwright BrowserContext.route](https://playwright.dev/docs/api/class-browsercontext)。
