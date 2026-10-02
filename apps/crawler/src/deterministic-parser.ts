import { techStackParser, type DomainFacts } from "./domain-facts.js";
import type {
  ExtractedSourceDocument,
  SourceFragment,
} from "./source-extractor.js";

export const DETERMINISTIC_PARSER_VERSION = "job-facts-v4";

const JSON_LD = "script[type='application/ld+json']:JobPosting";

export type ParsedFact<T> =
  | { status: "known"; value: T; excerpt: string; locator: string }
  | { status: "unknown" | "conflicting" };

export type SalaryRange = {
  minimum: number;
  maximum: number;
  currency: "JPY";
  period: "year";
};

/** Generic facts of any posting, plus optional occupation-specific ones. */
export type ParsedJobFacts = {
  salary: ParsedFact<SalaryRange>;
  location: ParsedFact<readonly string[]>;
  fullRemote: ParsedFact<boolean>;
  weeklyOfficeDays: ParsedFact<number>;
  scheduleFlexibility: ParsedFact<0 | 50 | 100>;
  targetRole: ParsedFact<string>;
  employmentType: ParsedFact<readonly string[]>;
} & DomainFacts;

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

type Known<T> = Extract<ParsedFact<T>, { status: "known" }>;

function safeExcerpt(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,})\b/g,
      "[secret]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{16,}\b/gi, "[secret]")
    .replace(/(?:\+?\d[\d ()-]{8,}\d)/g, "[phone]")
    .slice(0, 240);
}

function reduceFacts<T>(facts: readonly Known<T>[]): ParsedFact<T> {
  if (facts.length === 0) return { status: "unknown" };
  const values = new Set(facts.map((fact) => JSON.stringify(fact.value)));
  return values.size === 1 ? facts[0]! : { status: "conflicting" };
}

function collect<T>(
  fragments: readonly SourceFragment[],
  parse: (text: string) => readonly T[],
): ParsedFact<T> {
  const facts: Known<T>[] = [];
  for (const fragment of fragments) {
    for (const value of parse(fragment.text)) {
      facts.push({
        status: "known",
        value,
        excerpt: safeExcerpt(fragment.text),
        locator: fragment.locator,
      });
    }
  }
  return reduceFacts(facts);
}

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

function salary(text: string): SalaryRange[] {
  const results: SalaryRange[] = [];
  for (const match of text.matchAll(
    /年収\s*([0-9,]+)\s*万(?:円)?\s*(?:[〜~～\-–]|から)\s*([0-9,]+)\s*万(?:円)?/gu,
  )) {
    results.push(
      ...range(
        Number(match[1]!.replaceAll(",", "")) * 10_000,
        Number(match[2]!.replaceAll(",", "")) * 10_000,
      ),
    );
  }
  for (const match of text.matchAll(
    /年収\s*([0-9][0-9,]{5,})\s*円?\s*(?:[〜~～\-–]|から)\s*([0-9][0-9,]{5,})\s*円?/gu,
  )) {
    results.push(
      ...range(
        Number(match[1]!.replaceAll(",", "")),
        Number(match[2]!.replaceAll(",", "")),
      ),
    );
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

function locationNames(value: string): (typeof PREFECTURES)[number][] {
  const names: (typeof PREFECTURES)[number][] = PREFECTURES.filter((name) =>
    value.includes(name),
  );
  for (const [pattern, prefecture] of ENGLISH_LOCATIONS) {
    if (pattern.test(value) && !names.includes(prefecture)) names.push(prefecture);
  }
  if (value.includes("名古屋") && !names.includes("愛知県"))
    names.push("愛知県");
  return names;
}

function location(text: string): string[][] {
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

function fullRemote(text: string): boolean[] {
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

function weeklyOfficeDays(text: string): number[] {
  const requiredJapanese = [
    ...text.matchAll(/週\s*([0-5])\s*日?\s*(?:の)?\s*出社\s*必須/gu),
  ].map((match) => Number(match[1]));
  if (requiredJapanese.length) return requiredJapanese;

  const requiredEnglish = [
    ...text.matchAll(
      /(?:required|must)[^.]{0,140}(?:office|on[- ]?site)[^.]{0,100}(?:minimum\s+of|at\s+least)?\s*([0-5])\s*days?\s*per\s*week/giu,
    ),
  ].map((match) => Number(match[1]));
  if (requiredEnglish.length) return requiredEnglish;

  return [
    ...text.matchAll(/週\s*([0-5])\s*日?\s*(?:の)?\s*出社(?=$|[。．、，\s])/gu),
  ].map((match) => Number(match[1]));
}

function scheduleFlexibility(text: string): (0 | 50 | 100)[] {
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

function targetRoleFromText(text: string): string[] {
  const match =
    /(?:職種\s*\/\s*募集ポジション|募集ポジション)\s+(.{1,180}?)(?=\s+雇用形態(?:\s|$))/u.exec(
      text,
    );
  return match?.[1]?.trim() ? [match[1].trim()] : [];
}

function employmentType(text: string): string[][] {
  const match = /雇用形態\s+(正社員|契約社員|業務委託|アルバイト|パート|インターン)/u.exec(
    text,
  );
  if (!match) return [];
  const mapped: Record<string, string> = {
    正社員: "FULL_TIME",
    契約社員: "CONTRACTOR",
    業務委託: "CONTRACTOR",
    アルバイト: "PART_TIME",
    パート: "PART_TIME",
    インターン: "INTERN",
  };
  const value = mapped[match[1]!];
  return value ? [[value]] : [];
}

/**
 * Structured JobPosting data is the most reliable source; text parsing only
 * fills what it does not declare. When both declare different values the
 * fact is conflicting rather than silently picking one.
 */
function preferStructured<T>(
  structured: Known<T> | undefined,
  text: ParsedFact<T>,
): ParsedFact<T> {
  if (!structured) return text;
  if (
    text.status === "known" &&
    JSON.stringify(text.value) !== JSON.stringify(structured.value)
  )
    return { status: "conflicting" };
  return structured;
}

function known<T>(value: T, excerpt: string, field: string): Known<T> {
  return {
    status: "known",
    value,
    excerpt: safeExcerpt(excerpt),
    locator: `${JSON_LD}.${field}`,
  };
}

export function parseDeterministicJobFacts(
  document: ExtractedSourceDocument,
): ParsedJobFacts {
  const fragments = document.fragments.filter((item) => item.scope === "job");
  const structured = document.structuredJob;
  const regions = structured
    ? locationNames(structured.regions.join(" / "))
    : [];
  return {
    salary: collect(fragments, salary),
    location: preferStructured(
      regions.length && structured
        ? known([...regions], structured.regions.join(" / "), "jobLocation")
        : undefined,
      collect(fragments, location),
    ),
    fullRemote: preferStructured(
      structured?.telecommute
        ? known(true, "TELECOMMUTE", "jobLocationType")
        : undefined,
      collect(fragments, fullRemote),
    ),
    weeklyOfficeDays: collect(fragments, weeklyOfficeDays),
    scheduleFlexibility: collect(fragments, scheduleFlexibility),
    targetRole: document.jobIdentity
      ? known(document.jobIdentity.title, document.jobIdentity.title, "title")
      : collect(fragments, targetRoleFromText),
    employmentType:
      structured && structured.employmentTypes.length
        ? known(
            [...structured.employmentTypes],
            structured.employmentTypes.join(", "),
            "employmentType",
          )
        : collect(fragments, employmentType),
    techStack: collect(fragments, techStackParser.parse),
  };
}
