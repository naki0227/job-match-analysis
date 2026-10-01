import {
  decideResolution,
  fullMatch,
  rankCandidates,
  type CandidateSelection,
  type JobCandidate,
  type JobSearchQuery,
  type RankedCandidate,
  type Resolution,
} from "@job-match/domain";

/**
 * Mechanical discovery of existing postings (a database, an ATS listing).
 * Sources never invent URLs; each returns what it actually found.
 */
export type CandidateSource = {
  name: string;
  discover: (query: JobSearchQuery) => Promise<readonly JobCandidate[]>;
};

/** Semantic choice restricted to the given IDs or "none", e.g. Jev. */
export type CandidateSelector = (
  query: JobSearchQuery,
  candidates: readonly RankedCandidate[],
) => Promise<CandidateSelection>;

export type JobResolverDeps = {
  sources: readonly CandidateSource[];
  selector?: CandidateSelector;
  /** Most candidates passed to the selector (cost bound). */
  maxCandidates: number;
  onSourceError?: (source: string) => void;
  onSelectorError?: () => void;
};

export type JobResolution = Resolution & {
  /** Sources that failed; results may be incomplete. */
  failedSources: readonly string[];
  selectorUsed: boolean;
};

/**
 * discovery → normalization/filtering (domain) → semantic selection only
 * among the filtered candidates → decision (domain). A failing source or
 * selector degrades to fewer candidates or a user choice, never to a guess.
 */
export async function resolveJob(
  query: JobSearchQuery,
  deps: JobResolverDeps,
): Promise<JobResolution> {
  const settled = await Promise.allSettled(
    deps.sources.map((source) => source.discover(query)),
  );
  const failedSources: string[] = [];
  const found: JobCandidate[] = [];
  settled.forEach((result, index) => {
    const name = deps.sources[index]!.name;
    if (result.status === "fulfilled") found.push(...result.value);
    else {
      failedSources.push(name);
      deps.onSourceError?.(name);
    }
  });
  const ranked = rankCandidates(query, found, deps.maxCandidates);
  // A unique full match is decided mechanically; Jev is not needed.
  const onlyFullMatch = ranked.filter(fullMatch).length === 1;
  let selection: CandidateSelection | null = null;
  if (deps.selector && ranked.length > 0 && !onlyFullMatch) {
    try {
      selection = await deps.selector(query, ranked);
    } catch {
      deps.onSelectorError?.();
    }
  }
  return {
    ...decideResolution(ranked, selection),
    failedSources,
    selectorUsed: selection !== null,
  };
}
