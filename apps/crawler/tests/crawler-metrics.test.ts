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
      });
      metrics.jevBudgetExhausted({ candidates: 12 });
    }).not.toThrow();
  });

  it("swallows exporter failures so jobs keep running", () => {
    const safe = safeCrawlerMetrics({
      jevCall: () => {
        throw new Error("exporter down");
      },
      jevBudgetExhausted: () => {
        throw new Error("exporter down");
      },
    });
    expect(() =>
      safe.jevCall({
        candidates: 1,
        inputTokens: 1,
        outputTokens: 1,
        outcome: "success",
      }),
    ).not.toThrow();
    expect(() => safe.jevBudgetExhausted({ candidates: 1 })).not.toThrow();
  });
});
