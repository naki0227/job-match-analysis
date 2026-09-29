import { describe, expect, it, vi } from "vitest";
import { runCrawlerCycle } from "../src/crawler-cycle.js";
import type { AnalysisJobStore } from "../src/job-consumer.js";

describe("crawler cycle", () => {
  it("clears expired text before claiming the next job", async () => {
    const events: string[] = [];
    const claim = vi.fn(async () => {
      events.push("claim");
      return null;
    });
    const jobStore: AnalysisJobStore = {
      claim,
      renew: async () => false,
      fail: async () => false,
      complete: async () => "",
    };
    const result = await runCrawlerCycle({
      jobStore,
      retentionStore: {
        loadExpiredIds: async () => {
          events.push("retention");
          return [];
        },
        clearExpiredText: async () => 0,
      },
      processor: {
        loadSource: async () => null,
        siteApproved: async () => false,
        engine: {
          evaluate: async () => {
            throw new Error("unexpected");
          },
        },
        maxCandidates: 1,
        maxExcerptChars: 1,
      },
      leaseSeconds: 10,
      maxAttempts: 2,
      retentionBatchSize: 100,
      now: () => new Date("2026-10-01T00:00:00Z"),
    });
    expect(events).toEqual(["retention", "claim"]);
    expect(result).toEqual({
      clearedSourceTexts: 0,
      analysis: { status: "idle" },
    });
  });
});
