# ADR-044: 求人評価をkeyword事前選別から「上限付き全文context＋複数軸の一括判定」へ

> 状態: 決定（2026年10月01日）。ADR-021/026（取得境界）、ADR-039（Jev予算）、Issue #43（評価の出所）を前提にする。

## 背景・課題

本番で約10,000字の求人ページを解析したところ、8軸のうち`collaboration`だけが`known`になり、残り7軸は`unknown`だった。取得と抽出は成功していた。原因は候補選別（`axis-keywords-v2`）にある。

- 軸ごとの正規表現に一致した文だけをJevへ渡していたため、同じ意味を別の言葉で書いた文（例:「ほとんどの日は自宅から働いています」）はJevに届かなかった。
- 120字を超える文は候補から外していた。
- 全体の上限8件を、一致した軸で取り合っていた。

「正規表現に一致しなければ評価できない」構造そのものが問題だった。

## 決定

優先順位は次のとおり。構造化された事実 > 明示的なrule > Jevの意味判定 > `unknown`。

1. **抽出**: 既存のextractorで、nav・footer・script・hiddenを除いた本文を、段落・見出し・リスト単位の断片にする（変更なし）。
2. **context**（`context-fragments.ts`、`context-fragments-v1`）:
   - 求人（または会社）scopeの断片を、そのまま、または文単位で`CRAWLER_MAX_EXCERPT_CHARS`以下に切る。
   - 切った断片は必ず原文の部分文字列で、locatorは`<要素>:line-N:fragment-i:part-j`。
   - 重複、4字未満、メール・電話・tokenを含む断片は除く。
   - `CRAWLER_JEV_MAX_FRAGMENTS`と`CRAWLER_JEV_MAX_CONTEXT_CHARS`を超える場合に限り、働き方に関わる語を含む断片を優先して残し、ページ順で送る。上限内なら語に関係なく全て送る。
3. **rule**（`public-rules-v2`）: 「週N日出社」「原則出社」「コアタイムなし」など、明示的な文言で決まる軸を全断片に対して判定する。該当した断片はすべて根拠にする。
4. **Jev**（`jev-context-v2`）: ruleで決まらなかった軸について、**1回のrequest**で各軸に2つのchoice質問をする。
   - `judge_<軸>`: `0` / `50` / `100` / `conflicting` / `none`
   - `locate_<軸>`: `f1`〜`fN` / `none`
   - 断片はredactして、untrusted dataとして`state`に入れる。指示文でも、断片内の指示に従わないこと、会社名・業界・職種から推測しないことを明記する。
   - 選択肢は固定なので、anchorや根拠やURLを作り出す余地はない。
5. **採用基準**（`context-judgement.ts`）:
   - judgeの`min(confidence, 選んだ選択肢の確率)`が0.8以上（従来と同じ）。
   - locateで`none`以外の確率の合計が0.8以上（根拠がある確信）。
   - 確率0.1以上の断片を確率の高い順に最大`CRAWLER_MAX_EVIDENCE_PER_AXIS`件。
   - どれかを満たさなければ`unknown`。判定に自信があっても根拠断片が特定できないものは推測として扱う。`conflicting`も根拠が要る。
6. **根拠**: 1軸に複数の根拠を`evaluation_evidence`へ保存する。既存の`AxisDecision.evidenceIds`を使い、DBの変更はない。同じ文は重複排除する。
7. **versioning**:
   - `evaluatorVersion`は`job-facts-v1+public-rules-v2+jev-context-v2+context-fragments-v1`。
   - source set hashには送った断片そのもの（id・文・locator）とselector版を含める。旧評価とcacheが混ざらない。
   - 本番の`ANALYZER_VERSION`も上げ、既存の評価を再評価の対象にする。
8. **計測**: `job_match.evaluation.*`（抽出字数、断片数、送信数、rule後に残った軸、Jevへ送った軸、状態別の軸数、軸ごとの根拠数、所要時間）と`job_match.jev.*`（断片数、軸数、token、latency）。本文やURLはlabelにもlogにも出さない。
9. **Jev予算**（ADR-039）の単位は「送った断片数」に変える。env名`CRAWLER_JEV_DAILY_CANDIDATE_BUDGET`は互換のため維持する。

## コスト上限

1求人あたりJev呼び出しは最大1回。入力は`CRAWLER_JEV_MAX_CONTEXT_CHARS`字（redact後）と指示文（未解決の軸×2問）が上限。初期値の目安は断片60、12,000字、1断片200字、1軸3根拠。実際のtoken数はmetricsで確認して調整する。同じ正規化URL・analyzer版では共有job・評価cacheを再利用し、利用者ごとに再取得しない（既存設計）。

## 見送ったもの

- 断片ごと×軸ごとに1問ずつ尋ねる案: 質問数が断片数×8に増え、コストに合わない。
- ページ全文を1つの文字列で渡す案: 根拠の位置を再現できず、locatorを付けられない。

## メリット・デメリット

言い回しに依存せず、取得できた本文から判定できる。根拠が複数残り、説明しやすい。一方で、1回あたりの入力tokenは増える。上限を超える長いページでは、優先語による取捨選択が残る。判定の質はJevの確率の較正に依存するため、閾値はmetricsと実例を見て見直す。

## 見直し条件

unknown率・token数・誤判定の実例が見えた時、Jevの料金や上限が変わった時、上限超過のページが多い時（優先付けの改善）。
