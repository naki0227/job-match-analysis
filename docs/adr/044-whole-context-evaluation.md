# ADR-044: 求人評価を事前選別なしの全文context＋複数軸の一括判定へ

> 状態: 決定（2026年10月01日、2026年10月02日改訂）。ADR-021/026（取得境界）、ADR-039（Jev予算）、Issue #43（評価の出所）を前提にする。

## 背景・課題

本番で求人ページを解析したところ、取得できている本文が評価器へ届かず、多くの軸が`unknown`になる事例が続いた。

最初の実装では軸ごとのkeywordに一致した文だけをJevへ渡していた。その後、全文contextへ寄せたが、60断片・12,000字という暫定上限を超えた場合には働き方に関するkeywordを含む断片を優先して残していた。この上限はモデルの技術上限や精度検証から決めた値ではなく、1断片200字×60断片という初期のコストガードだった。

そのため、上限を超える求人では結局「正規表現に一致した文章ほどJevへ届きやすい」構造が残り、裁量・協働・役割の幅・顧客接点など言い換えの多い軸で情報を落とす可能性があった。

## 決定

優先順位は次のとおり。構造化された事実 > 明示的なrule > Jevの意味判定 > `unknown`。

1. **抽出**: extractorでnav・footer・script・hiddenなど評価対象ではないWeb UIを除いた公開本文を抽出する。
2. **context**（`context-fragments.ts`、`context-fragments-v3`）:
   - 求人（または会社）scopeの抽出済み本文をページ順のまま全て評価対象にする。
   - `CRAWLER_JEV_MAX_FRAGMENTS`と`CRAWLER_JEV_MAX_CONTEXT_CHARS`は廃止する。アプリ側は断片数・総文字数を理由に本文を選別・破棄しない。
   - `CRAWLER_MAX_EXCERPT_CHARS`は情報量を削る上限ではない。根拠位置を特定し保存するため、長い断片をロスなく複数の部分文字列へ分けるサイズとしてのみ使う。
   - keywordによる優先順位付け、短い見出し・重複文・連絡先を理由とした事前除外は行わない。Jevへ送る際の秘密・連絡先のredactは従来どおり行う。
3. **rule**（`public-rules-v3`）: 「週N日出社」「原則出社」「コアタイムなし」など、明示的な文言で決まる軸を全断片に対して判定する。該当した断片は根拠にする。
4. **Jev**（`jev-context-v3`）: ruleで決まらなかった軸について、各軸に2つのchoice質問をする。求人本文が責務・条件として直接示している内容からの局所的な意味推論は許可する。一方、会社名・業界・職種名・評判・外部知識からの推測は禁止する。
   - `judge_<軸>`: `0` / `50` / `100` / `conflicting` / `none`
   - `locate_<軸>`: `f1`〜`fN` / `none`
   - 断片はredactしてuntrusted dataとして`state`に入れる。会社名・業界・職種から推測しない。
5. **採用基準**（`context-judgement.ts`）:
   - judgeの`min(confidence, 選んだ選択肢の確率)`が0.8以上。
   - locateで`none`以外の確率の合計が0.8以上。
   - 確率0.1以上の断片を確率の高い順に最大`CRAWLER_MAX_EVIDENCE_PER_AXIS`件。
   - 根拠を特定できない判断は`unknown`とする。
6. **根拠**: 1軸に複数の根拠を`evaluation_evidence`へ保存する。
7. **versioning**:
   - selector版は`context-fragments-v3`。求人事実parserを`job-facts-v4`、ruleを`public-rules-v4`、公開rubricを`public-anchors-v2`、Jev evaluatorを`jev-context-v3`へ上げる。
   - source set hashにはJevへ渡した全断片（id・文・locator）とselector版を含める。
   - 本番の`ANALYZER_VERSION`を`analysis-v5`へ上げ、以前の選別あり・過度に厳しいrubricで作った評価をfresh cacheとして再利用しない。
8. **計測**: 抽出字数、断片数、送信数、Jev token、known/unknown/conflicting数、根拠数、所要時間を計測する。本文やURLはmetric labelやlogへ出さない。
9. **Jev予算**: 日次予算は独立した運用ガードとして残す。本文選別の理由には使わない。本番は現在`unlimited`。

## コストと技術上限

アプリ独自の12,000字・60断片上限は持たない。取得した評価対象本文をすべてJevへ送る。

外部サービス自身のrequest/context上限はアプリの情報選別ルールとは分離して扱う。実際のinput token数・latency・provider errorはmetricsで観測し、必要になった場合は本文を捨てるのではなく、ロスレスな分割処理を別途設計する。

同じ正規化URL・analyzer版では共有job・評価cacheを再利用するため、利用者ごとに同じ本文を再評価しない。

## メリット・デメリット

取得できた情報を自前のkeywordが捨てないため、表現の揺れが大きい軸でもJevの意味判定まで届く。一方で長い求人ではinput token・choice数・latencyが増える。これはmetricsで可視化し、精度を落とす事前選別ではなく外部評価器側の性能・費用として管理する。

## 見直し条件

Jevの実request上限に到達する実例、token数・latency・料金の問題、誤判定の実例が確認されたとき。見直す場合も、情報を捨てるkeyword選別ではなくロスレス分割を優先する。


## 2026-10-02: unknown率の見直し

全文をJevへ渡した後も、実求人で8軸中6軸がunknownになった。本文には「full software development lifecycle」「technical support to clients」「working hours at their own discretion」など判断材料が存在していたため、unknownの一部は情報不足ではなく評価条件の厳しさによるものだった。

- 公開rubricを利用者向け質問の0/50/100の意味に合わせる。特にcustomer contactの50は「定期的」ではなく「必要時・ときどき」、work changeの50は「定型と変化の両方を明記」ではなく「一定の変化」、role breadthの100は複数工程・機能の横断を含む。
- Jevには「同じ単語が書かれていること」ではなく、記載された責務・条件がanchorを十分に支持するかを問う。根拠fragmentは引き続き必須とする。
- HRMOSのような日本語label＋英語valueの求人について、給与、勤務地、出社日数、勤務時間裁量、雇用形態、職種を決定論的に読む。
