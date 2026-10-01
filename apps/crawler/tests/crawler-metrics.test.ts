import { describe, expect, it } from "vitest";
import { createOtelCrawlerMetrics } from "../src/crawler-metrics-otel.js";
import { safeCrawlerMetrics } from "../src/crawler-metrics.js";

const evaluationEvent = {
  scope: "job" as const,
  extractedChars: 10_409,
  fragmentsAvailable: 120,
  fragmentsSent: 60,
  unresolvedAfterRules: 8,
  axesSentToJev: 8,
  known: 5,
  unknown: 3,
  conflicting: 0,
  evidencePerAxis: [2, 1, 3, 1, 2],
  durationMs: 4_000,
};

describe("crawler metrics", () => {
  it("is a no-op without an SDK and never throws", () => {
    const metrics = createOtelCrawlerMetrics();
    expect(() => {
      metrics.jevCall({
        fragments: 30,
        axes: 6,
        inputTokens: 100,
        outputTokens: null,
        outcome: "success",
        durationMs: 120,
      });
      metrics.jevBudgetExhausted({ fragments: 12 });
      metrics.jevBudgetMode("unlimited");
      metrics.analysisJob({ outcome: "completed", durationMs: 3_000 });
      metrics.evaluation(evaluationEvent);
    }).not.toThrow();
  });

  it("swallows exporter failures so jobs keep running", () => {
    const down = () => {
      throw new Error("exporter down");
    };
    const safe = safeCrawlerMetrics({
      jevCall: down,
      jevBudgetExhausted: down,
      jevBudgetMode: down,
      analysisJob: down,
      discovery: down,
      evaluation: down,
    });
    expect(() =>
      safe.jevCall({
        fragments: 1,
        axes: 1,
        inputTokens: 1,
        outputTokens: 1,
        outcome: "success",
        durationMs: 1,
      }),
    ).not.toThrow();
    expect(() => safe.jevBudgetExhausted({ fragments: 1 })).not.toThrow();
    expect(() => safe.evaluation(evaluationEvent)).not.toThrow();
    expect(() => safe.jevBudgetMode("finite")).not.toThrow();
    expect(() =>
      safe.analysisJob({ outcome: "failed", durationMs: 1 }),
    ).not.toThrow();
  });
});
