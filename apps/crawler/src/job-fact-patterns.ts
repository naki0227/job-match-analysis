import type { SalaryRange } from "./deterministic-parser.js";

/**
 * Text patterns for job facts. Each takes one piece of page text and
 * returns every value it states explicitly; nothing is inferred.
 */
const PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
] as const;

const ENGLISH_LOCATIONS: readonly [RegExp, (typeof PREFECTURES)[number]][] = [
  [/\bHokkaido\b|\bSapporo\b/iu, "北海道"],
  [/\bMiyagi\b|\bSendai\b/iu, "宮城県"],
  [/\bSaitama\b/iu, "埼玉県"],
  [/\bChiba\b/iu, "千葉県"],
  [/\bTokyo\b/iu, "東京都"],
  [/\bKanagawa\b|\bYokohama\b/iu, "神奈川県"],
  [/\bAichi\b|\bNagoya\b/iu, "愛知県"],
  [/\bKyoto\b/iu, "京都府"],
  [/\bOsaka\b/iu, "大阪府"],
  [/\bHyogo\b|\bKobe\b/iu, "兵庫県"],
  [/\bNara\b/iu, "奈良県"],
  [/\bHiroshima\b/iu, "広島県"],
  [/\bFukuoka\b/iu, "福岡県"],
];

function range(minimum: number, maximum: number): SalaryRange[] {
  return Number.isSafeInteger(minimum) &&
    Number.isSafeInteger(maximum) &&
    minimum > 0 &&
    maximum >= minimum
    ? [
        {
          minimum,
          maximum,
          currency: "JPY" as const,
          period: "year" as const,
        },
      ]
    : [];
}

const MAN_RANGE =
  /([0-9][0-9,]*)\s*万(?:円)?\s*(?:[〜~～\-–]|から)\s*([0-9][0-9,]*)\s*万(?:円)?/gu;
const YEN_RANGE =
  /([0-9][0-9,]{5,})\s*円?\s*(?:[〜~～\-–]|から)\s*([0-9][0-9,]{5,})\s*円?/gu;
const amount = (value: string) => Number(value.replaceAll(",", ""));

function ranges(text: string): SalaryRange[] {
  return [
    ...[...text.matchAll(MAN_RANGE)].flatMap((match) =>
      range(amount(match[1]!) * 10_000, amount(match[2]!) * 10_000),
    ),
    ...[...text.matchAll(YEN_RANGE)].flatMap((match) =>
      range(amount(match[1]!), amount(match[2]!)),
    ),
  ];
}

export function salary(text: string): SalaryRange[] {
  const results: SalaryRange[] = [];
  // Only a range written right after 年収 is an annual salary.
  for (const match of text.matchAll(
    /年収\s*[:：]?\s*([0-9][0-9,]*\s*(?:万(?:円)?|円)?\s*(?:[〜~～\-–]|から)\s*[0-9][0-9,]*\s*(?:万(?:円)?|円)?)/gu,
  )) {
    results.push(...ranges(match[1]!));
  }

  if (/salary\s*range|給与|年収/iu.test(text)) {
    const annual = [...text.matchAll(/([0-9][0-9,]{5,})\s*JPY\s*\/\s*year/giu)]
      .map((match) => Number(match[1]!.replaceAll(",", "")))
      .filter((value) => Number.isSafeInteger(value) && value > 0);
    if (annual.length >= 2) {
      results.push(...range(Math.min(...annual), Math.max(...annual)));
    }
  }
  return results;
}

/**
 * An annual range in text the evaluator located as the salary. The text or
 * its heading must still say it is annual; monthly or hourly pay is never
 * read as a year.
 */
export function locatedSalary(section: string, text: string): SalaryRange[] {
  const context = `${section} ${text}`;
  if (
    /月給|月収|月額|時給|日給|monthly|hourly|per\s+month|per\s+hour/iu.test(
      context,
    )
  )
    return [];
  if (!/年収|年俸|annual|per\s+year|\/\s*year/iu.test(context)) return [];
  return ranges(text);
}

export function locationNames(value: string): (typeof PREFECTURES)[number][] {
  const names: (typeof PREFECTURES)[number][] = PREFECTURES.filter((name) =>
    value.includes(name),
  );
  for (const [pattern, prefecture] of ENGLISH_LOCATIONS) {
    if (pattern.test(value) && !names.includes(prefecture))
      names.push(prefecture);
  }
  const japaneseCities: readonly [RegExp, (typeof PREFECTURES)[number]][] = [
    [/札幌(?:市|支社|開発拠点|$)/u, "北海道"],
    [/仙台(?:市|支社|開発拠点|$)/u, "宮城県"],
    [/横浜(?:市|支社|開発拠点|$)/u, "神奈川県"],
    [/名古屋(?:市|支社|開発拠点|$)/u, "愛知県"],
    [/(?<!東)京都(?:市|支社|開発拠点|$)/u, "京都府"],
    [/大阪(?:市|支社|開発拠点|$)/u, "大阪府"],
    [/神戸(?:市|支社|開発拠点|$)/u, "兵庫県"],
    [/広島(?:市|支社|開発拠点|$)/u, "広島県"],
    [/福岡(?:市|支社|開発拠点|$)/u, "福岡県"],
  ];
  for (const [pattern, prefecture] of japaneseCities) {
    if (pattern.test(value) && !names.includes(prefecture))
      names.push(prefecture);
  }
  return PREFECTURES.filter((name) => names.includes(name));
}

export function location(text: string): string[][] {
  const match =
    /(?:^|\s)(?:勤務地(?:の所在地)?|Work\s+Location|Location)(?:\s*[:：]\s*|\s+)(.{1,500}?)(?=\s(?:働き方|休日|休暇|待遇|福利厚生|勤務時間|応募|選考|職種|雇用形態|給与|Salary\s+System|Working\s+Hour(?:s|\s+System)?|Work\s+Style\s+Policy|Holidays|Benefits|Selection\s+Process)(?:\s|[（(])|$)/iu.exec(
      text,
    );
  if (!match) return [];
  const value = match[1]!;
  if (/将来的|予定|相談|応相談|全国|可能性|変更/u.test(value)) return [];
  const names = locationNames(value);
  return names.length ? [[...names]] : [];
}

export function fullRemote(text: string): boolean[] {
  const negative =
    /フルリモート不可|完全在宅不可|出社\s*必須|原則[、,\s]*出社|(?:required|must)[^.]{0,140}(?:work|be)[^.]{0,100}(?:office|on[- ]?site)/iu.test(
      text,
    );
  const positive =
    /フルリモート(?:可|可能|勤務|制度)|完全在宅(?:可|可能|勤務)|出社不要|\bfully?\s+remote\b|\bfull[- ]remote\b|\bwork\s+from\s+anywhere\b/iu.test(
      text,
    );
  return [...(negative ? [false] : []), ...(positive ? [true] : [])];
}

export function weeklyOfficeDays(text: string): number[] {
  const requiredJapanese = [
    ...text.matchAll(/週\s*([0-5])\s*日?\s*(?:の)?\s*出社\s*必須/gu),
  ].map((match) => Number(match[1]));
  if (requiredJapanese.length) return requiredJapanese;

  const requiredEnglish = [
    ...text.matchAll(
      /(?:required|must)[^.]{0,160}(?:office|on[- ]?site)[^.]{0,80}(?:a\s+)?(?:minimum\s+of|at\s+least)\s*([0-5])\s*days?\s*per\s*week/giu,
    ),
  ].map((match) => Number(match[1]));
  if (requiredEnglish.length) return requiredEnglish;

  const minimumOfficeDays = [
    ...text.matchAll(
      /(?:office|on[- ]?site)[^.]{0,60}(?:a\s+)?(?:minimum\s+of|at\s+least)\s*([0-5])\s*days?\s*per\s*week/giu,
    ),
  ].map((match) => Number(match[1]));
  if (minimumOfficeDays.length) return minimumOfficeDays;

  return [
    ...text.matchAll(/週\s*([0-5])\s*日?\s*(?:の)?\s*出社(?=$|[。．、，\s])/gu),
  ].map((match) => Number(match[1]));
}

export function scheduleFlexibility(text: string): (0 | 50 | 100)[] {
  const fixed =
    /フレックスなし|固定勤務時間|勤務時間固定|\bfixed\s+working\s+hours?\b/iu.test(
      text,
    );
  const full =
    /フルフレックス|コアタイムなし|\bno\s+core\s+time\b|\bdiscretionary\s+labor\s+system\b|choose[^.]{0,80}working\s+hours?[^.]{0,80}(?:own\s+discretion|their\s+own\s+discretion)/iu.test(
      text,
    );
  const partial =
    /フレックスタイム制|コアタイムあり|\bflextime\s+system\b|\bflexible\s+working\s+hours?\b/iu.test(
      text,
    );
  return [
    ...(fixed ? [0 as const] : []),
    ...(full ? [100 as const] : []),
    ...(partial && !full ? [50 as const] : []),
  ];
}

export function targetRoleFromText(text: string): string[] {
  const match =
    /(?:職種\s*\/\s*募集ポジション|募集ポジション)\s+(.{1,180}?)(?=\s+雇用形態(?:\s|$))/u.exec(
      text,
    );
  return match?.[1]?.trim() ? [match[1].trim()] : [];
}

const EMPLOYMENT_WORDS: Record<string, string> = {
  正社員: "FULL_TIME",
  契約社員: "CONTRACTOR",
  業務委託: "CONTRACTOR",
  アルバイト: "PART_TIME",
  パート: "PART_TIME",
  インターン: "INTERN",
};

export function employmentType(text: string): string[][] {
  const match =
    /雇用形態\s+(正社員|契約社員|業務委託|アルバイト|パート|インターン)/u.exec(
      text,
    );
  const value = match ? EMPLOYMENT_WORDS[match[1]!] : undefined;
  return value ? [[value]] : [];
}

/** Employment types named in text the evaluator located as the type. */
export function locatedEmploymentTypes(text: string): string[] {
  return [
    ...new Set(
      [
        ...text.matchAll(
          /正社員|契約社員|業務委託|アルバイト|パート|インターン/gu,
        ),
      ].map((match) => EMPLOYMENT_WORDS[match[0]]!),
    ),
  ];
}
