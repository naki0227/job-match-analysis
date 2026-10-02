import type { ContextFragment } from "./decision-engine.js";
import type { ParsedFact } from "./deterministic-parser.js";

/**
 * What the posting says about the work, in its own words: duties, the
 * people and experience it asks for, and how the work is done. Each quote
 * is an exact piece of the page under the heading or label it appeared in.
 */
export type SectionQuote = { section: string | null; text: string };
export type JobSectionKind = "duties" | "requirements" | "workStyle";
export type JobSections = Record<
  JobSectionKind,
  ParsedFact<readonly SectionQuote[]>
>;

export const JOB_SECTION_KINDS: readonly JobSectionKind[] = [
  "duties",
  "requirements",
  "workStyle",
];

/**
 * Heading and label wording that names each section. These match the
 * page's own headings, never the body text, so a duty that merely mentions
 * "remote" is not filed under work style.
 */
const HEADINGS: Record<JobSectionKind, RegExp> = {
  duties:
    /業務内容|仕事内容|職務内容|業務詳細|担当業務|お任せ|ミッション|役割|具体的な業務|responsibilit|what you(?:'ll| will) do|job description|about the (?:role|job)|the role/iu,
  requirements:
    /求める|必須(?:スキル|条件|要件|経験)?|応募資格|応募条件|歓迎|望ましい|尚可|人物像|requirement|qualification|must have|nice to have|preferred|what we(?:'re| are) looking for/iu,
  workStyle:
    /働き方|勤務形態|勤務時間|就業時間|リモート|出社|在宅|work\s*style|working hours|remote/iu,
};

/** Descriptions for the evaluator when no heading names a section. */
export const SECTION_DESCRIPTIONS: Record<JobSectionKind, string> = {
  duties: "the duties or responsibilities of this job",
  requirements:
    "the skills, experience or qualities this job requires or prefers",
  workStyle:
    "how the work is done: office attendance, remote work or working hours",
};

function classify(section: string): JobSectionKind | undefined {
  // Work style first: "勤務時間" must not fall into duties via "務".
  if (HEADINGS.workStyle.test(section)) return "workStyle";
  if (HEADINGS.requirements.test(section)) return "requirements";
  if (HEADINGS.duties.test(section)) return "duties";
  return undefined;
}

export function sectionFact(
  fragments: readonly ContextFragment[],
): ParsedFact<readonly SectionQuote[]> {
  // A fragment that is only its own heading says nothing beyond the label.
  const quotes = fragments.filter(
    (fragment) => fragment.text.trim() !== fragment.section?.trim(),
  );
  const first = quotes[0];
  if (!first) return { status: "unknown" };
  return {
    status: "known",
    value: quotes.map((fragment) => ({
      section: fragment.section ?? null,
      text: fragment.text,
    })),
    excerpt: first.text,
    locator: first.locator,
  };
}

/** Sections named by the page's own headings and row labels. */
export function readJobSections(
  fragments: readonly ContextFragment[],
): JobSections {
  const grouped: Record<JobSectionKind, ContextFragment[]> = {
    duties: [],
    requirements: [],
    workStyle: [],
  };
  for (const fragment of fragments) {
    const kind = fragment.section ? classify(fragment.section) : undefined;
    if (kind) grouped[kind].push(fragment);
  }
  return {
    duties: sectionFact(grouped.duties),
    requirements: sectionFact(grouped.requirements),
    workStyle: sectionFact(grouped.workStyle),
  };
}
