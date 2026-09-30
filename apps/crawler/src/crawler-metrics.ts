/**
 * Vendor-neutral measurements emitted by the crawler. An OpenTelemetry
 * adapter implements this port (Issue #32); domain code never imports a
 * telemetry SDK. Labels carry counts and outcomes only, never page text,
 * URLs with queries, tokens or personal data.
 */
export type JevCallOutcome = "success" | "transient_error" | "provider_error";

export type CrawlerMetrics = {
  jevCall: (event: {
    candidates: number;
    inputTokens: number | null;
    outputTokens: number | null;
    outcome: JevCallOutcome;
  }) => void;
  jevBudgetExhausted: (event: { candidates: number }) => void;
};

export const noopCrawlerMetrics: CrawlerMetrics = {
  jevCall: () => {},
  jevBudgetExhausted: () => {},
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
  };
}
