import { metrics } from "@opentelemetry/api";
import type { CrawlerMetrics } from "./crawler-metrics.js";

/**
 * OpenTelemetry adapter for crawler measurements (Issue #32). Without a
 * registered SDK these instruments are no-ops; the deployment chooses the
 * exporter. Only counts and outcomes are recorded.
 */
export function createOtelCrawlerMetrics(): CrawlerMetrics {
  const meter = metrics.getMeter("job-match-crawler");
  const calls = meter.createCounter("job_match.jev.calls", {
    description: "Jev evaluation calls by outcome",
  });
  const candidates = meter.createCounter("job_match.jev.candidates", {
    description: "Evidence candidates sent to Jev",
  });
  const tokens = meter.createCounter("job_match.jev.tokens", {
    description: "Jev tokens reported by the provider",
  });
  const exhausted = meter.createCounter("job_match.jev.budget_exhausted", {
    description: "Evaluations that skipped Jev because the budget was spent",
  });
  const jevDuration = meter.createHistogram("job_match.jev.duration", {
    unit: "s",
    description: "Jev call latency by outcome",
  });
  const budgetMode = meter.createGauge("job_match.jev.budget_mode", {
    description: "1 for the active Jev budget mode (finite or unlimited)",
  });
  const jobDuration = meter.createHistogram("job_match.analysis_job.duration", {
    unit: "s",
    description: "Analysis job processing time by final outcome",
  });
  return {
    jevCall: ({
      candidates: count,
      inputTokens,
      outputTokens,
      outcome,
      durationMs,
    }) => {
      calls.add(1, { outcome });
      jevDuration.record(durationMs / 1_000, { outcome });
      candidates.add(count, { outcome });
      if (inputTokens !== null) tokens.add(inputTokens, { direction: "input" });
      if (outputTokens !== null) {
        tokens.add(outputTokens, { direction: "output" });
      }
    },
    jevBudgetExhausted: ({ candidates: count }) =>
      exhausted.add(1, { candidates_bucket: count > 8 ? "9+" : String(count) }),
    jevBudgetMode: (mode) => {
      budgetMode.record(mode === "finite" ? 1 : 0, { mode: "finite" });
      budgetMode.record(mode === "unlimited" ? 1 : 0, { mode: "unlimited" });
    },
    analysisJob: ({ outcome, durationMs }) =>
      jobDuration.record(durationMs / 1_000, { outcome }),
  };
}
