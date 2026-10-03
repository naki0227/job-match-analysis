import {
  isExplicitTechStackLine,
  isTechStackSection,
  techStackParser,
  type DomainFacts,
} from "./domain-facts.js";
import type {
  ExtractedSourceDocument,
  SourceFragment,
  SourceSection,
} from "./source-extractor.js";

import { redactSensitiveText } from "./redaction.js";
import {
  employmentType,
  fullRemote,
  location,
  locationNames,
  salary,
  scheduleFlexibility,
  targetRoleFromText,
  weeklyOfficeDays,
} from "./job-fact-patterns.js";

export const DETERMINISTIC_PARSER_VERSION = "job-facts-v9";

const JSON_LD = "script[type='application/ld+json']:JobPosting";

/**
 * `method: "jev"` marks a value read from fragments the evaluator located
 * after the parser found none; without it the parser read it directly.
 */
export type ParsedFact<T> =
  | {
      status: "known";
      value: T;
      excerpt: string;
      locator: string;
      method?: "jev";
    }
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

type Known<T> = Extract<ParsedFact<T>, { status: "known" }>;

function safeExcerpt(text: string): string {
  return redactSensitiveText(text).slice(0, 240);
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

function collectStringUnion(
  fragments: readonly SourceFragment[],
  parse: (text: string) => readonly (readonly string[])[],
): ParsedFact<readonly string[]> {
  const found: { values: readonly string[]; fragment: SourceFragment }[] = [];
  for (const fragment of fragments) {
    for (const values of parse(fragment.text)) {
      if (values.length) found.push({ values, fragment });
    }
  }
  if (!found.length) return { status: "unknown" };
  const value = [...new Set(found.flatMap((item) => item.values))];
  return {
    status: "known",
    value,
    excerpt: safeExcerpt(found.map((item) => item.fragment.text).join(" / ")),
    locator: found[0]!.fragment.locator,
  };
}

/** Consecutive fragments under the same heading or row label. */
function sectionGroups(fragments: readonly SourceFragment[]): SourceFragment[] {
  const groups: SourceFragment[] = [];
  let current: { first: SourceFragment; texts: string[] } | null = null;
  const flush = () => {
    if (current && current.texts.length > 1)
      groups.push({
        ...current.first,
        text: current.texts.join(" "),
        locator: `${current.first.locator}:section`,
      });
  };
  for (const fragment of fragments) {
    if (
      current &&
      fragment.section &&
      fragment.section === current.first.section
    ) {
      current.texts.push(fragment.text);
      continue;
    }
    flush();
    current = fragment.section
      ? { first: fragment, texts: [fragment.text] }
      : null;
  }
  flush();
  return groups;
}

/**
 * The shortest run of consecutive fragments that states `value`, so the
 * stored excerpt is where the value is written, not the top of the page.
 */
function shortestRun<T>(
  fragments: readonly SourceFragment[],
  parse: (text: string) => readonly T[],
  value: T,
): Pick<Known<T>, "excerpt" | "locator"> | undefined {
  const expected = JSON.stringify(value);
  for (let size = 1; size <= fragments.length; size += 1) {
    for (let start = 0; start + size <= fragments.length; start += 1) {
      const run = fragments.slice(start, start + size);
      const text = run.map((fragment) => fragment.text).join(" ");
      if (parse(text).some((item) => JSON.stringify(item) === expected))
        return {
          excerpt: safeExcerpt(text),
          locator: `${run[0]!.locator}:run-${size}`,
        };
    }
  }
  return undefined;
}

/**
 * Field facts (salary, location, role, employment type) are read from the
 * fragment that states them; when a label and its value sit in different
 * fragments, from the section they share; and only then from the whole job
 * text. Evidence is always the smallest text that states the value.
 */
function collectField<T>(
  fragments: readonly SourceFragment[],
  whole: SourceSection | undefined,
  parse: (text: string) => readonly T[],
): ParsedFact<T> {
  const direct = collect(fragments, parse);
  if (direct.status !== "unknown") return direct;
  const grouped = collect(sectionGroups(fragments), parse);
  if (grouped.status !== "unknown") return grouped;
  if (!whole) return direct;
  const all = collect(
    [{ scope: "job", text: whole.text, locator: `${whole.locator}:whole` }],
    parse,
  );
  if (all.status !== "known") return all;
  return { ...all, ...shortestRun(fragments, parse, all.value) };
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

function mergeLocations(
  structured: Known<readonly string[]> | undefined,
  text: ParsedFact<readonly string[]>,
): ParsedFact<readonly string[]> {
  if (!structured) return text;
  if (text.status === "unknown") return structured;
  if (text.status !== "known") return text;
  const value = [...new Set([...structured.value, ...text.value])];
  return {
    status: "known",
    value,
    excerpt: safeExcerpt(`${structured.excerpt} / ${text.excerpt}`),
    locator: text.locator,
  };
}

export function parseDeterministicJobFacts(
  document: ExtractedSourceDocument,
): ParsedJobFacts {
  const fragments = document.fragments.filter((item) => item.scope === "job");
  const wholeJob = document.sections.find((item) => item.scope === "job");
  const field = <T>(parse: (text: string) => readonly T[]) =>
    collectField(fragments, wholeJob, parse);
  const structured = document.structuredJob;
  const targetRole = document.jobIdentity
    ? known(document.jobIdentity.title, document.jobIdentity.title, "title")
    : field(targetRoleFromText);
  const stackFragments = fragments.filter(
    (fragment) =>
      isTechStackSection(fragment.section) ||
      isExplicitTechStackLine(fragment.text),
  );
  const techFragments: readonly SourceFragment[] =
    stackFragments.length > 0
      ? stackFragments
      : targetRole.status === "known"
        ? [
            {
              scope: "job",
              text: targetRole.value,
              locator: targetRole.locator,
            },
          ]
        : [];
  const regions = structured
    ? locationNames(structured.regions.join(" / "))
    : [];
  return {
    salary: field(salary),
    location: mergeLocations(
      regions.length && structured
        ? known([...regions], structured.regions.join(" / "), "jobLocation")
        : undefined,
      field(location),
    ),
    fullRemote: preferStructured(
      structured?.telecommute
        ? known(true, "TELECOMMUTE", "jobLocationType")
        : undefined,
      collect(fragments, fullRemote),
    ),
    weeklyOfficeDays: collect(fragments, weeklyOfficeDays),
    scheduleFlexibility: collect(fragments, scheduleFlexibility),
    targetRole,
    employmentType:
      structured && structured.employmentTypes.length
        ? known(
            [...structured.employmentTypes],
            structured.employmentTypes.join(", "),
            "employmentType",
          )
        : field(employmentType),
    techStack: collectStringUnion(techFragments, techStackParser.parse),
  };
}
