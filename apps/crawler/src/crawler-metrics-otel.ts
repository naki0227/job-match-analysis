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
  const sourceFetches = meter.createCounter("job_match.source_fetch.pages", {
    description:
      "Source pages read, by renderer and whether rendering was partial",
  });
  const discovery = createDiscoveryInstruments(meter);
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
    discovery,
    evaluation: quality,
    sourceFetch: ({ renderer, blockedRendering }) =>
      sourceFetches.add(1, {
        renderer,
        render: blockedRendering > 0 ? "partial" : "complete",
      }),
  };
}

function createDiscoveryInstruments(
  meter: ReturnType<typeof metrics.getMeter>,
): CrawlerMetrics["discovery"] {
  const counter = (name: string, description: string) =>
    meter.createCounter(`job_match.discovery.${name}`, { description });
  const runs = counter("runs", "Web discoveries by outcome");
  const searches = counter("searches", "External search calls");
  const failures = counter("search_failures", "Failed searches by kind");
  const results = counter("search_results", "Search results (leads)");
  const fetched = counter("fetched", "Pages fetched while verifying");
  const listings = counter("listings_expanded", "Listings followed one hop");
  const verified = counter("verified", "Verified job postings");
  const rejected = counter("rejected", "Leads rejected by reason");
  const duration = meter.createHistogram("job_match.discovery.duration", {
    unit: "s",
    description: "Web discovery time",
  });
  return (event) => {
    runs.add(1, { outcome: event.outcome });
    searches.add(event.queries);
    for (const [kind, count] of Object.entries(event.searchFailures))
      failures.add(count ?? 0, { kind });
    results.add(event.searchResults);
    fetched.add(event.fetched);
    listings.add(event.listingsExpanded);
    verified.add(event.verified);
    for (const [reason, count] of Object.entries(event.rejected))
      rejected.add(count ?? 0, { reason });
    duration.record(event.durationMs / 1_000, { outcome: event.outcome });
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
    axes.add(event.range, { ...labels, status: "range" });
    axes.add(event.unknown, { ...labels, status: "unknown" });
    axes.add(event.conflicting, { ...labels, status: "conflicting" });
  };
}
