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

/**
 * Web discovery of postings that are not known yet (ADR-047). It runs
 * asynchronously: a fresh result is reused, otherwise a background search is
 * started (or joined) and polled by its ID. Unavailable never breaks a
 * search; known postings are still answered.
 */
export type DiscoveryOutcome =
  | { status: "ready"; candidates: readonly JobCandidate[]; cached: boolean }
  | { status: "pending"; discoveryId: string }
  | {
      status: "unavailable";
      reason: "rate_limited" | "busy" | "failed" | "error";
    };

export type JobDiscovery = (query: JobSearchQuery) => Promise<DiscoveryOutcome>;

export type JobResolverDeps = {
  sources: readonly CandidateSource[];
  selector?: CandidateSelector;
  /** Most candidates passed to the selector (cost bound). */
  maxCandidates: number;
  /** Most postings in a company-only list. */
  listingLimit?: number;
  discovery?: JobDiscovery;
  /** Known postings that make a company-only listing good enough. */
  knownListingMinimum?: number;
  onSourceError?: (source: string) => void;
  onSelectorError?: () => void;
  onDiscovery?: (outcome: DiscoveryOutcome["status"] | "skipped") => void;
};

export type JobResolution =
  | (Resolution & {
      /** Sources that failed; results may be incomplete. */
      failedSources: readonly string[];
      selectorUsed: boolean;
    })
  | {
      status: "searching";
      discoveryId: string;
      failedSources: readonly string[];
      selectorUsed: false;
    };

async function collect(
  query: JobSearchQuery,
  deps: JobResolverDeps,
): Promise<{ found: JobCandidate[]; failedSources: string[] }> {
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
  return { found, failedSources };
}

/** Known postings answer the query without searching the web. */
function knownIsEnough(
  ranked: readonly RankedCandidate[],
  deps: JobResolverDeps,
): boolean {
  if (ranked.length === 0) return false;
  if (ranked[0]!.totalTerms === 0) {
    return ranked.length >= (deps.knownListingMinimum ?? 1);
  }
  return ranked.some(fullMatch);
}

async function discover(
  query: JobSearchQuery,
  discovery: JobDiscovery,
): Promise<DiscoveryOutcome> {
  try {
    return await discovery(query);
  } catch {
    return { status: "unavailable", reason: "error" };
  }
}

/**
 * known postings → (only if not enough) web discovery → mechanical
 * filtering (domain) → semantic selection only among the filtered set, and
 * never for a company-only listing → decision (domain).
 */
export async function resolveJob(
  query: JobSearchQuery,
  deps: JobResolverDeps,
): Promise<JobResolution> {
  const { found, failedSources } = await collect(query, deps);
  let ranked = rankCandidates(query, found, deps.maxCandidates);
  if (deps.discovery && !knownIsEnough(ranked, deps)) {
    const outcome = await discover(query, deps.discovery);
    deps.onDiscovery?.(outcome.status);
    if (outcome.status === "pending") {
      return {
        status: "searching",
        discoveryId: outcome.discoveryId,
        failedSources,
        selectorUsed: false,
      };
    }
    if (outcome.status === "ready") {
      // Discovered entries carry the verified source and details, so they
      // win over the same URL listed as a known posting.
      ranked = rankCandidates(
        query,
        [...outcome.candidates, ...found],
        deps.maxCandidates,
      );
    } else {
      failedSources.push("discovery");
    }
  } else if (deps.discovery) {
    deps.onDiscovery?.("skipped");
  }
  const listing = ranked.length > 0 && ranked[0]!.totalTerms === 0;
  // A unique full match is decided mechanically; Jev is not needed. A
  // company-only listing is never narrowed down for the user.
  const needsSelector =
    !listing && ranked.length > 0 && ranked.filter(fullMatch).length !== 1;
  let selection: CandidateSelection | null = null;
  if (deps.selector && needsSelector) {
    try {
      selection = await deps.selector(query, ranked);
    } catch {
      deps.onSelectorError?.();
    }
  }
  return {
    ...decideResolution(ranked, selection, deps.listingLimit),
    failedSources,
    selectorUsed: selection !== null,
  };
}
