import type {
  ExtractedSourceDocument,
  SourceFragment,
} from "./source-extractor.js";

export const DETERMINISTIC_PARSER_VERSION = "job-facts-v1";

export type ParsedFact<T> =
  | { status: "known"; value: T; excerpt: string; locator: string }
  | { status: "unknown" | "conflicting" };

export type SalaryRange = {
  minimum: number;
  maximum: number;
  currency: "JPY";
  period: "year";
};

export type ParsedJobFacts = {
  salary: ParsedFact<SalaryRange>;
  location: ParsedFact<readonly string[]>;
  fullRemote: ParsedFact<boolean>;
  weeklyOfficeDays: ParsedFact<number>;
  scheduleFlexibility: ParsedFact<0 | 50 | 100>;
  targetRole: ParsedFact<string>;
  techStack: ParsedFact<readonly string[]>;
};

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

function salary(text: string): SalaryRange[] {
  const matches = text.matchAll(
    /年収\s*([0-9,]+)\s*万(?:円)?\s*(?:[〜~～\-–]|から)\s*([0-9,]+)\s*万(?:円)?/gu,
  );
  return [...matches].flatMap((match) => {
    const minimum = Number(match[1]!.replaceAll(",", "")) * 10_000;
    const maximum = Number(match[2]!.replaceAll(",", "")) * 10_000;
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
  });
}

function location(text: string): string[][] {
  const match = /^勤務地\s*[:：]\s*(.+)$/u.exec(text);
  if (!match) return [];
  const names = PREFECTURES.filter((name) => match[1]!.includes(name));
  const remainder = names
    .reduce((value, name) => value.replaceAll(name, ""), match[1]!)
    .replace(/(?:または|もしくは|及び|、|,|，|／|\/|\s)+/gu, "");
  return names.length && !remainder ? [[...names]] : [];
}

function techStack(text: string): string[][] {
  const match = /^技術スタック\s*[:：]\s*(.+)$/u.exec(text);
  if (!match) return [];
  const names = match[1]!.split(/[、,，／/]/u).map((item) => item.trim());
  if (
    names.length === 0 ||
    names.length > 20 ||
    names.some((name) => !/^[A-Za-z][A-Za-z0-9+#. -]{0,39}$/u.test(name))
  )
    return [];
  return [names];
}

function fullRemote(text: string): boolean[] {
  const negative = /フルリモート不可|完全在宅不可|出社必須|原則出社/u.test(
    text,
  );
  const positive =
    /フルリモート(?:可|可能|勤務|制度)|完全在宅(?:可|可能|勤務)|出社不要/u.test(
      text,
    );
  return [...(negative ? [false] : []), ...(positive ? [true] : [])];
}

function weeklyOfficeDays(text: string): number[] {
  return [...text.matchAll(/週\s*([0-5])\s*日出社(?=$|[。．、，\s])/gu)].map(
    (match) => Number(match[1]),
  );
}

function scheduleFlexibility(text: string): (0 | 50 | 100)[] {
  const fixed = /フレックスなし|固定勤務時間|勤務時間固定/u.test(text);
  const full = /フルフレックス|コアタイムなし/u.test(text);
  const partial = /フレックスタイム制|コアタイムあり/u.test(text);
  return [
    ...(fixed ? [0 as const] : []),
    ...(full ? [100 as const] : []),
    ...(partial && !full ? [50 as const] : []),
  ];
}

export function parseDeterministicJobFacts(
  document: ExtractedSourceDocument,
): ParsedJobFacts {
  const fragments = document.fragments.filter((item) => item.scope === "job");
  const role = document.jobIdentity
    ? {
        status: "known" as const,
        value: document.jobIdentity.title,
        excerpt: document.jobIdentity.title,
        locator: "script[type='application/ld+json']:JobPosting.title",
      }
    : { status: "unknown" as const };
  return {
    salary: collect(fragments, salary),
    location: collect(fragments, location),
    fullRemote: collect(fragments, fullRemote),
    weeklyOfficeDays: collect(fragments, weeklyOfficeDays),
    scheduleFlexibility: collect(fragments, scheduleFlexibility),
    targetRole: role,
    techStack: collect(fragments, techStack),
  };
}
