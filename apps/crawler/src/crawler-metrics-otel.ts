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
  const fragments = meter.createCounter("job_match.jev.fragments", {
    description: "Context fragments sent to Jev",
  });
  const axes = meter.createCounter("job_match.jev.axes", {
    description: "Axes judged by Jev",
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
  const quality = createEvaluationInstruments(meter);
  return {
    jevCall: ({
      fragments: fragmentCount,
      axes: axisCount,
      inputTokens,
      outputTokens,
      outcome,
      durationMs,
    }) => {
      calls.add(1, { outcome });
      jevDuration.record(durationMs / 1_000, { outcome });
      fragments.add(fragmentCount, { outcome });
      axes.add(axisCount, { outcome });
      if (inputTokens !== null) tokens.add(inputTokens, { direction: "input" });
      if (outputTokens !== null) {
        tokens.add(outputTokens, { direction: "output" });
      }
    },
    jevBudgetExhausted: () => exhausted.add(1),
    jevBudgetMode: (mode) => {
      budgetMode.record(mode === "finite" ? 1 : 0, { mode: "finite" });
      budgetMode.record(mode === "unlimited" ? 1 : 0, { mode: "unlimited" });
    },
    analysisJob: ({ outcome, durationMs }) =>
      jobDuration.record(durationMs / 1_000, { outcome }),
    evaluation: quality,
  };
}

function createEvaluationInstruments(
  meter: ReturnType<typeof metrics.getMeter>,
): CrawlerMetrics["evaluation"] {
  const histogram = (name: string, description: string, unit?: string) =>
    meter.createHistogram(`job_match.evaluation.${name}`, {
      description,
      ...(unit ? { unit } : {}),
    });
  const chars = histogram("extracted_chars", "Extracted text length");
  const available = histogram("fragments_available", "Usable fragments");
  const sent = histogram("fragments_sent", "Fragments sent within limits");
  const unresolved = histogram(
    "unresolved_after_rules",
    "Axes left after deterministic rules",
  );
  const toJev = histogram("axes_sent_to_jev", "Axes sent to Jev");
  const evidence = histogram("evidence_per_axis", "Evidence per cited axis");
  const duration = histogram("duration", "Source evaluation time", "s");
  const axes = meter.createCounter("job_match.evaluation.axes", {
    description: "Evaluated axes by observation status",
  });
  return (event) => {
    const labels = { scope: event.scope };
    chars.record(event.extractedChars, labels);
    available.record(event.fragmentsAvailable, labels);
    sent.record(event.fragmentsSent, labels);
    unresolved.record(event.unresolvedAfterRules, labels);
    toJev.record(event.axesSentToJev, labels);
    for (const count of event.evidencePerAxis) evidence.record(count, labels);
    duration.record(event.durationMs / 1_000, labels);
    axes.add(event.known, { ...labels, status: "known" });
    axes.add(event.unknown, { ...labels, status: "unknown" });
    axes.add(event.conflicting, { ...labels, status: "conflicting" });
  };
}
