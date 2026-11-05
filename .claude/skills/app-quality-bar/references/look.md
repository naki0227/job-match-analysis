# 見た目：世界観・色・書体・形

出典の略記：SR = StudyReel（`StudyTimerAndVideo/`）、GM = 五十音マインスイーパー（`src/`）。値はコードで測ったもの。

## 1. 題材の世界観を部品にする
2本とも、「アプリの題材の現物」を画面の部品にしている。これが一番の個性になっている。

| アプリ | 題材の現物 | 部品にした形（実測） |
|---|---|---|
| SR | 勉強ノート・記録の紙 | `GridPaper`：方眼 20pt 間隔・線 0.6、上→下へ薄くなる重ね（`Views/GoalCardStyle.swift:25-58`）。`TapeShape`：両端ギザギザ（歯 4・深さ最大 4pt）・78×20・-4° 傾け（:62-97）。`TapedPaper`：テープで貼った白い紙・角丸 18（:100-122）。`Polaroid`：4:3 の写真＋セリフ体イタリック 13pt の一言・+3° 傾け・テープ +6°（:125-166） |
| SR | カメラ | 録画ボタンはシャッター：外の白い輪 直径 72・太さ 3、待機は直径 58 の丸、録画中は角丸 6 の 26×26 の四角（`ContentView.swift:380-398`） |
| GM | 五十音表 | 五十音表そのものが盤面。長音「ー」も独立したマス（`game/board.ts`） |
| GM | キーボードのキー・判子 | 閉じたマスは白・枠 1px・**下辺だけ 3px** で押せるキーに見せる（`components/tileStyles.ts:22-28`）。モード選択のタイルは角丸 0・枠 2px の判子調・最小高さ 74（`HomeModes.tsx:129-152`） |
| GM | 題字 | 30×30 の正方形 3 枚に「五・十・音」17/900、「音」だけ主色（`HomeTitle.tsx:55-66`） |

やり方：
- 題材の棚卸し（物・場所・道具・紙もの・札・盤・数字・手順を 10 個）から、**画面の主役になる形を1つ、脇役を1〜2つ**選ぶ
- 主役は SwiftUI の `Shape` / `Canvas` / 自作の部品で描く。画像の貼り付けや SF Symbols の置き換えで済ませない
- 傾け（±3〜6°）、紙の質感（方眼・罫・粒）、厚み（下辺だけ太い線）など、**少しだけ現実に寄せる**手掛かりを入れる
- 世界観は全画面で守る（ホームだけ凝って、設定や結果が素のリストにならない）

## 2. 色
- **1か所で決める**。GM：「Use these instead of hex literals so a color change happens in one place」（`theme/colors.ts:1-2`）
- **1色ごとに5段階**を持つ（SR `Utilities/ThemeColor.swift:43-106`）：accent（主）/ soft（淡い地）/ deep（白文字が読める濃さ。白い文字を載せるボタンは必ず deep）/ paper（紙の地）/ 飾り（テープ）。例 sky：accent `#9EC3E2`・soft `#E1EDF6`・deep `#5E8DB8`・paper `#F7F8FA`・tape `#F2CBD0`
- 地と文字は真っ白・真っ黒にしない：SR 地 `#F3F6F9`・文字 `#2E3A46`・補助 `#8E9AA6`・線 `#E3E9EF`（`ReelTheme.swift:5-24`）。GM 地 `#f7fafc`・文字 `#102433`・補助 `#7b8992`・線 `#d5dee4`（`colors.ts:3-20`）
- **意味のある色の段階**：GM は周りの地雷の数で色を変える（0 `#9aa7b0`・1 主色・2 成功・3 強い強調・4 以上 危険、`colors.ts:23-29`）。数・状態・進み具合に色の段階を持たせる
- グラデーションは原則使わない（GM は 0 件、SR は空と雲だけ）。使うなら題材に理由がある所だけ（空・光・時間帯）
- **季節・時間で変わる配色**：GM は 10/24〜11/1 に自動でハロウィン配色、盤面のマスは変えない（`theme/season.ts:5-24`）
- ダークモード：SR は `.preferredColorScheme(.light)` で固定（`App.swift:61`）。固定するなら理由を書く。対応するなら paper・文字・線の段階をダーク用にも作り、撮って確かめる

## 3. 書体
- **2書体を役割で分ける**：SR は見出しと大きな数字にセリフ（`.system(design: .serif)`）、本文はサンセリフ（`ReelTheme.swift:13-19`）。GM はフォントを足さず、**太さ 800〜900** で個性を出す
- 大きな数字は字間を詰める：`.kerning(-3)`〜`-4`、または `-size*0.04`（SR `GoalShareView.swift:339,427,518`、`GoalCardStyle.swift:238`）。小さなラベルは開ける：`.kerning(0.6)`（:275）
- 変わる数字は `monospacedDigit()`（SR 約 30 か所）、はみ出しそうな所は `minimumScaleFactor(0.6〜0.8)`
- 本文の大きさの中心は 11〜15pt（SR：12pt 77 回・11pt 76 回・13pt 65 回）。太字は少なく、regular / medium / semibold を中心に
- Dynamic Type：SR は固定サイズで非対応（弱い所）。新しいアプリは `.font(.body)` 系か `relativeTo:` で拡大に追従させる

## 4. 形・余白・影
- 角丸は 1 種類にしない。SR：14pt 20 回・18pt 16 回・12pt 10 回・6pt 9 回、すべて `style: .continuous`。GM：ボタン 10・ポップアップ 18・マスは `max(5, size*0.2)`
- 余白は段階を決める：SR は 2/4/6/8/10/12/14/16/20/24（spacing 10 が最多）。大きい画面は `.frame(maxWidth: 560)` で幅を抑える（SR 11 か所）
- 影は弱く、種類を絞る：普段は opacity 0.06〜0.08・radius 10〜12・y 4〜6。浮いた物だけ強く（ポラロイド 0.18・r8・y6、案内の吹き出し 0.25・r16・y6）（SR `GoalCardStyle.swift:114,160`、`CoachMarks.swift:155`）。GM のカード：ink 0.18・r18・y6
- 線で立体を出す：ピルは `shadow(color: line, radius: 0, y: 1)`（SR :185）、マスは下辺だけ 3px（GM）
- 押せる物の大きさは最小 44pt（GM `buttonStyles.ts:8-37`）。主なボタンは高さ 52（SR オンボーディング）

## 5. 画面の大きさ
- 盤面や主役の幅に上限を持つ：GM 最大幅 620（英語盤 430）、マスの間隔 3（`CharacterBoard.tsx:25,173-181`）
- 横向き・大きな画面のスクリーンショットを撮って確かめる（SR は横向きの UI テストと layout-check の CI を持つ、`docs/ci.md:6`）
