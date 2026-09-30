import { describe, expect, it } from "vitest";
import { createOtelCrawlerMetrics } from "../src/crawler-metrics-otel.js";
import { safeCrawlerMetrics } from "../src/crawler-metrics.js";

describe("crawler metrics", () => {
  it("is a no-op without an SDK and never throws", () => {
    const metrics = createOtelCrawlerMetrics();
    expect(() => {
      metrics.jevCall({
        candidates: 3,
        inputTokens: 100,
        outputTokens: null,
        outcome: "success",
        durationMs: 120,
      });
      metrics.jevBudgetExhausted({ candidates: 12 });
      metrics.jevBudgetMode("unlimited");
      metrics.analysisJob({ outcome: "completed", durationMs: 3_000 });
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
    });
    expect(() =>
      safe.jevCall({
        candidates: 1,
        inputTokens: 1,
        outputTokens: 1,
        outcome: "success",
        durationMs: 1,
      }),
    ).not.toThrow();
    expect(() => safe.jevBudgetExhausted({ candidates: 1 })).not.toThrow();
    expect(() => safe.jevBudgetMode("finite")).not.toThrow();
    expect(() =>
      safe.analysisJob({ outcome: "failed", durationMs: 1 }),
    ).not.toThrow();
  });
});
