import type { ContextFragment, LocateQuestion } from "./decision-engine.js";
import type { ParsedFact, ParsedJobFacts } from "./deterministic-parser.js";
import {
  locatedEmploymentTypes,
  locatedSalary,
  locationNames,
  weeklyOfficeDays,
} from "./job-fact-patterns.js";
import {
  JOB_SECTION_KINDS,
  SECTION_DESCRIPTIONS,
  sectionFact,
  type JobSections,
} from "./job-sections.js";

/**
 * Facts the evaluator may locate when the parser could not read them. The
 * evaluator only names fragments; the value is read from their exact text
 * by the same kind of pattern the parser uses, so nothing is generated.
 */
const LOCATABLE = {
  salary: {
    description: "the annual salary or annual pay range",
    read: (fragment: ContextFragment) =>
      locatedSalary(fragment.section ?? "", fragment.text),
  },
  location: {
    description: "where this job is located (prefecture, city or office)",
    read: (fragment: ContextFragment) =>
      /将来的|予定|可能性/u.test(fragment.text)
        ? []
        : locationNames(fragment.text).map((name) => [name]),
  },
  weeklyOfficeDays: {
    description: "how many days a week the employee must work at the office",
    read: (fragment: ContextFragment) => weeklyOfficeDays(fragment.text),
  },
  employmentType: {
    description: "the employment type (full-time, contract, part-time)",
    read: (fragment: ContextFragment) => {
      const types = locatedEmploymentTypes(fragment.text);
      return types.length ? [types] : [];
    },
  },
} as const;

type LocatableFact = keyof typeof LOCATABLE;
const LOCATABLE_FACTS = Object.keys(LOCATABLE) as LocatableFact[];

export function locateQuestions(
  facts: ParsedJobFacts,
  sections: JobSections,
): LocateQuestion[] {
  return [
    ...LOCATABLE_FACTS.filter((key) => facts[key].status === "unknown").map(
      (key) => ({ key, description: LOCATABLE[key].description }),
    ),
    ...JOB_SECTION_KINDS.filter(
      (kind) => sections[kind].status === "unknown",
    ).map((kind) => ({ key: kind, description: SECTION_DESCRIPTIONS[kind] })),
  ];
}

type Known<T> = Extract<ParsedFact<T>, { status: "known" }>;

function readLocated<T>(
  fragments: readonly ContextFragment[],
  read: (fragment: ContextFragment) => readonly T[],
  merge: "same" | "union",
): ParsedFact<T> {
  const found: Known<T>[] = fragments.flatMap((fragment) =>
    read(fragment).map((value) => ({
      status: "known" as const,
      value,
      excerpt: fragment.text,
      locator: fragment.locator,
    })),
  );
  const first = found[0];
  if (!first) return { status: "unknown" };
  if (merge === "union") {
    const values = [
      ...new Set(found.flatMap((fact) => fact.value as readonly string[])),
    ];
    return { ...first, value: values as T };
  }
  const distinct = new Set(found.map((fact) => JSON.stringify(fact.value)));
  return distinct.size === 1 ? first : { status: "conflicting" };
}

/**
 * Fills only facts and sections that are still unknown. A located fragment
 * that does not state a readable value leaves the fact unknown.
 */
export function applyLocated(args: {
  facts: ParsedJobFacts;
  sections: JobSections;
  located: Readonly<Record<string, readonly string[]>>;
  fragments: readonly ContextFragment[];
}): { facts: ParsedJobFacts; sections: JobSections } {
  const byId = new Map(
    args.fragments.map((fragment) => [fragment.id, fragment]),
  );
  // Keep page order so quotes read as the page does.
  const pick = (key: string) =>
    (args.located[key] ?? [])
      .map((id) => byId.get(id))
      .filter((fragment): fragment is ContextFragment => fragment !== undefined)
      .sort((a, b) => args.fragments.indexOf(a) - args.fragments.indexOf(b));
  const facts = { ...args.facts };
  for (const key of LOCATABLE_FACTS) {
    const located = pick(key);
    if (facts[key].status !== "unknown" || located.length === 0) continue;
    const fact = readLocated<unknown>(
      located,
      LOCATABLE[key].read,
      key === "location" ? "union" : "same",
    );
    if (fact.status !== "unknown")
      (facts as Record<LocatableFact, ParsedFact<unknown>>)[key] =
        fact.status === "known" ? { ...fact, method: "jev" } : fact;
  }
  const sections = { ...args.sections };
  for (const kind of JOB_SECTION_KINDS) {
    const located = pick(kind);
    if (sections[kind].status !== "unknown" || located.length === 0) continue;
    const fact = sectionFact(located);
    sections[kind] =
      fact.status === "known" ? { ...fact, method: "jev" } : fact;
  }
  return { facts, sections };
}
