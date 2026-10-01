/**
 * Vendor-neutral measurements emitted by the crawler. An OpenTelemetry
 * adapter implements this port (Issue #32); domain code never imports a
 * telemetry SDK. Labels carry counts and outcomes only, never page text,
 * URLs with queries, tokens or personal data.
 */
export type JevCallOutcome = "success" | "transient_error" | "provider_error";

export type JobOutcome =
  "completed" | "retry_pending" | "failed" | "lease_lost" | "error";

/**
 * Quality of one source evaluation (Issue #44 follow-up): counts only, so
 * "too many unknowns" can be measured instead of guessed.
 */
export type EvaluationEvent = {
  scope: "company" | "job";
  extractedChars: number;
  /** Usable fragments on the page, and those sent within the limits. */
  fragmentsAvailable: number;
  fragmentsSent: number;
  /** Axes left after deterministic rules, and those actually sent to Jev. */
  unresolvedAfterRules: number;
  axesSentToJev: number;
  known: number;
  unknown: number;
  conflicting: number;
  /** Evidence fragments stored for each axis that has any. */
  evidencePerAxis: readonly number[];
  durationMs: number;
};

/** One web discovery (ADR-047): counts and bounded reasons only. */
export type DiscoveryEvent = {
  queries: number;
  searchFailures: Partial<
    Record<"timeout" | "blocked" | "unavailable", number>
  >;
  searchResults: number;
  fetched: number;
  listingsExpanded: number;
  verified: number;
  rejected: Partial<Record<string, number>>;
  outcome: "completed" | "retry" | "failed";
  durationMs: number;
};

export type CrawlerMetrics = {
  jevCall: (event: {
    fragments: number;
    axes: number;
    inputTokens: number | null;
    outputTokens: number | null;
    outcome: JevCallOutcome;
    durationMs: number;
  }) => void;
  jevBudgetExhausted: (event: { fragments: number }) => void;
  /** Recorded once per process so dashboards always show the active mode. */
  jevBudgetMode: (mode: "finite" | "unlimited") => void;
  /** One claimed analysis job, from claim to its final state. */
  analysisJob: (event: { outcome: JobOutcome; durationMs: number }) => void;
  discovery: (event: DiscoveryEvent) => void;
  evaluation: (event: EvaluationEvent) => void;
};

export const noopCrawlerMetrics: CrawlerMetrics = {
  jevCall: () => {},
  jevBudgetExhausted: () => {},
  jevBudgetMode: () => {},
  analysisJob: () => {},
  discovery: () => {},
  evaluation: () => {},
};

/** Telemetry failures must never stop evaluation. */
export function safeCrawlerMetrics(inner: CrawlerMetrics): CrawlerMetrics {
  const guard =
    <T>(record: (event: T) => void) =>
    (event: T) => {
      try {
        record(event);
      } catch {
        // Dropping a measurement is acceptable; failing a job is not.
      }
    };
  return {
    jevCall: guard(inner.jevCall),
    jevBudgetExhausted: guard(inner.jevBudgetExhausted),
    jevBudgetMode: guard(inner.jevBudgetMode),
    analysisJob: guard(inner.analysisJob),
    discovery: guard(inner.discovery),
    evaluation: guard(inner.evaluation),
  };
}
