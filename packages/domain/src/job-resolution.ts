/**
 * Job Resolver rules (ADR-045): turn "company + role" into one existing job
 * posting, or into a short list for the user to choose from. Candidates only
 * ever come from mechanical discovery; nothing here creates a URL.
 */

export type EmploymentPreference =
  "full_time" | "part_time" | "contract" | "intern" | "new_grad";

export type JobSearchQuery = {
  company: string;
  roleQuery: string;
  employmentType?: EmploymentPreference;
};

export type JobCandidate = {
  companyName: string;
  title: string;
  url: string;
  source: string;
  /** schema.org style values when the source declares them. */
  employmentTypes: readonly string[];
  location?: string;
};

/** Semantic choice among the given candidate IDs, e.g. from Jev. */
export type CandidateSelection = {
  choice: string;
  confidence: number;
  probabilities: Readonly<Record<string, number>>;
};

export type RankedCandidate = JobCandidate & {
  id: string;
  matchedTerms: number;
  totalTerms: number;
};

export type ResolutionReason =
  "no_candidates" | "single_full_match" | "confident_selection" | "ambiguous";

export type Resolution =
  | { status: "resolved"; candidate: RankedCandidate; reason: ResolutionReason }
  | {
      status: "candidates";
      candidates: readonly RankedCandidate[];
      reason: ResolutionReason;
    }
  | { status: "not_found"; reason: ResolutionReason };

/** Accept a semantic choice only when it is sure and clearly ahead. */
export const MIN_SELECTION_CONFIDENCE = 0.8;
export const MAX_RUNNER_UP_PROBABILITY = 0.15;
export const MAX_CHOICES_SHOWN = 3;

const LEGAL_FORMS =
  /株式会社|有限会社|合同会社|一般社団法人|（株）|\(株\)|㈱|inc\.?|co\.,?\s*ltd\.?|ltd\.?|corporation|corp\.?|llc|k\.k\./giu;

function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

export function normalizeCompanyName(name: string): string {
  return fold(name)
    .replace(LEGAL_FORMS, "")
    .replace(/[\s・.,、。'"’()（）-]+/gu, "");
}

export function sameCompany(query: string, candidate: string): boolean {
  const a = normalizeCompanyName(query);
  const b = normalizeCompanyName(candidate);
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}

export function roleTerms(roleQuery: string): string[] {
  return [
    ...new Set(
      fold(roleQuery)
        .split(/[\s、,，・/／()（）]+/u)
        .filter((term) => term.length > 0),
    ),
  ];
}

const EMPLOYMENT_WORDS: Record<EmploymentPreference, RegExp> = {
  full_time: /正社員|中途|full.?time/iu,
  part_time: /パート|アルバイト|part.?time/iu,
  contract: /契約|業務委託|派遣|contract/iu,
  intern: /インターン|intern/iu,
  new_grad: /新卒|新卒採用|new.?grad|graduate/iu,
};

const EMPLOYMENT_TYPES: Record<EmploymentPreference, readonly string[]> = {
  full_time: ["FULL_TIME"],
  part_time: ["PART_TIME"],
  contract: ["CONTRACTOR", "TEMPORARY"],
  intern: ["INTERN"],
  new_grad: [],
};

/**
 * true/false when the posting states it, null when it does not say. A
 * posting that does not say is kept, never guessed.
 */
export function employmentFits(
  candidate: JobCandidate,
  preference: EmploymentPreference | undefined,
): boolean | null {
  if (!preference) return null;
  const declared = EMPLOYMENT_TYPES[preference];
  if (declared.length && candidate.employmentTypes.length) {
    return candidate.employmentTypes.some((item) => declared.includes(item));
  }
  if (EMPLOYMENT_WORDS[preference].test(candidate.title)) return true;
  const other = (Object.keys(EMPLOYMENT_WORDS) as EmploymentPreference[]).some(
    (key) => key !== preference && EMPLOYMENT_WORDS[key].test(candidate.title),
  );
  return other ? false : null;
}

/**
 * Mechanical narrowing: same company, employment not contradicted, then
 * ranked by how many of the role terms the title contains. IDs are assigned
 * here so a selector can only answer with one of them.
 */
export function rankCandidates(
  query: JobSearchQuery,
  candidates: readonly JobCandidate[],
  limit: number,
): RankedCandidate[] {
  const terms = roleTerms(query.roleQuery);
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return (
        sameCompany(query.company, candidate.companyName) &&
        employmentFits(candidate, query.employmentType) !== false
      );
    })
    .map((candidate, order) => ({
      candidate,
      order,
      matched: terms.filter((term) => fold(candidate.title).includes(term))
        .length,
    }))
    .sort((a, b) => b.matched - a.matched || a.order - b.order)
    .slice(0, limit)
    .map(({ candidate, matched }, index) => ({
      ...candidate,
      id: `c${index + 1}`,
      matchedTerms: matched,
      totalTerms: terms.length,
    }));
}

export function fullMatch(candidate: RankedCandidate): boolean {
  return (
    candidate.totalTerms > 0 && candidate.matchedTerms === candidate.totalTerms
  );
}

/**
 * Explainable decision:
 * - no candidates → not_found
 * - exactly one candidate whose title contains every role term → resolved
 *   (several full matches, e.g. a too generic query, are ambiguous)
 * - a selection that is confident (≥ 0.8) with no close runner-up (≤ 0.15)
 *   → resolved
 * - otherwise the top few for the user, ordered by the selection when there
 *   is one, else by the deterministic rank
 */
export function decideResolution(
  ranked: readonly RankedCandidate[],
  selection: CandidateSelection | null,
): Resolution {
  if (ranked.length === 0)
    return { status: "not_found", reason: "no_candidates" };
  const full = ranked.filter(fullMatch);
  const only = full.length === 1 ? full[0] : undefined;
  if (only) {
    return { status: "resolved", candidate: only, reason: "single_full_match" };
  }
  if (selection) {
    const chosen = ranked.find((item) => item.id === selection.choice);
    const certainty = Math.min(
      selection.confidence,
      selection.probabilities[selection.choice] ?? 0,
    );
    const runnerUp = Math.max(
      0,
      ...Object.entries(selection.probabilities)
        .filter(([id]) => id !== selection.choice)
        .map(([, probability]) => probability),
    );
    if (
      chosen &&
      certainty >= MIN_SELECTION_CONFIDENCE &&
      runnerUp <= MAX_RUNNER_UP_PROBABILITY
    ) {
      return {
        status: "resolved",
        candidate: chosen,
        reason: "confident_selection",
      };
    }
    const byProbability = [...ranked].sort(
      (a, b) =>
        (selection.probabilities[b.id] ?? 0) -
        (selection.probabilities[a.id] ?? 0),
    );
    return {
      status: "candidates",
      candidates: byProbability.slice(0, MAX_CHOICES_SHOWN),
      reason: "ambiguous",
    };
  }
  return {
    status: "candidates",
    candidates: ranked.slice(0, MAX_CHOICES_SHOWN),
    reason: "ambiguous",
  };
}
