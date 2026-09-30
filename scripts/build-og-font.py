"""Build the Noto Sans JP subset used only by the server-side OG renderer.

Reproducible input: Noto Sans JP variable font from google/fonts
(ofl/notosansjp, SIL Open Font License 1.1). Steps:
  1. fix the variable font at weight 700 (satori needs a static font)
  2. keep ASCII, Latin-1 punctuation, full-width forms, kana, every
     JIS X 0208 character (level 1 and 2 kanji) and the Windows-31J (CP932)
     extensions such as 髙 and 﨑 that appear in company and person names
Usage:
  python scripts/build-og-font.py <NotoSansJP[wght].ttf> <output.ttf>
Requires fonttools (pip install fonttools).
"""

import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer


def jis_x_0208_characters() -> set[str]:
    chars: set[str] = set()
    for row in range(0xA1, 0xFF):
        for cell in range(0xA1, 0xFF):
            try:
                chars.add(bytes([row, cell]).decode("euc_jp"))
            except UnicodeDecodeError:
                continue
    return chars


def cp932_characters() -> set[str]:
    chars: set[str] = set()
    for lead in list(range(0x81, 0xA0)) + list(range(0xE0, 0xFD)):
        for trail in list(range(0x40, 0x7F)) + list(range(0x80, 0xFD)):
            try:
                chars.add(bytes([lead, trail]).decode("cp932"))
            except UnicodeDecodeError:
                continue
    return chars


def main(source: str, target: str) -> None:
    font = TTFont(source)
    static = instancer.instantiateVariableFont(font, {"wght": 700})
    characters = jis_x_0208_characters() | cp932_characters()
    characters.update(chr(code) for code in range(0x20, 0x7F))
    characters.update(chr(code) for code in range(0xA0, 0x100))
    characters.update(chr(code) for code in range(0x3000, 0x3100))
    characters.update(chr(code) for code in range(0xFF00, 0xFFF0))
    characters.update("・…―‐〜々〆ヶ")
    options = subset.Options()
    options.layout_features = ["kern", "palt", "vert"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=[ord(char) for char in characters])
    subsetter.subset(static)
    static.save(target)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
