# OG画像用フォント

- `NotoSansJP-Bold-subset.ttf`: Noto Sans JP（google/fonts `ofl/notosansjp/NotoSansJP[wght].ttf`、SHA-256 `c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f`）をweight 700に固定し、ASCII・かな・全角記号・JIS X 0208の全文字・Windows-31J（CP932）の拡張文字（髙・﨑など）にsubsetしたもの。生成手順は`scripts/build-og-font.py`。
- ライセンス: SIL Open Font License 1.1（`OFL.txt`）。改変版（subset）を同梱する場合もOFLの条件に従い、このライセンス文書を一緒に置く。
- サーバー側のOG画像描画（Issue #39）だけで使う。HTTPで配信せず、利用者向けの成果物として配布しない。
