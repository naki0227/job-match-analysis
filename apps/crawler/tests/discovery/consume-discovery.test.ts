import { describe, expect, it, vi } from "vitest";
import { runCrawlerCycle } from "../../src/crawler-cycle.js";
import { noopCrawlerMetrics } from "../../src/crawler-metrics.js";
import {
  consumeOneDiscovery,
  type DiscoveryRuntime,
} from "../../src/discovery/consume-discovery.js";
import type { DiscoveryStore } from "../../src/discovery/discovery-store.js";
import { WebSearchError } from "../../src/discovery/web-search.js";
import { runUntilIdle } from "../../src/worker-loop.js";
import { jobPage } from "./pages.js";

const limits = {
  maxQueries: 1,
  resultsPerQuery: 5,
  maxFetches: 5,
  maxLinksPerListing: 5,
  maxResults: 5,
};

function runtime(queue: number, search: DiscoveryRuntime["search"]) {
  const completed: unknown[][] = [];
  const failed: unknown[][] = [];
  let left = queue;
  const store: DiscoveryStore = {
    claim: async (token) =>
      left-- > 0
        ? {
            discoveryId: `d${left}`,
            query: { company: "サンプル" },
            attempts: 1,
            workerToken: token,
          }
        : null,
    complete: async (...args) => {
      completed.push(args);
    },
    fail: async (...args) => {
      failed.push(args);
    },
  };
  const value: DiscoveryRuntime = {
    store,
    search,
    createFetcher: () => async (url) => ({
      url,
      html: jobPage({ title: "法人営業", org: "サンプル" }),
    }),
    limits,
    leaseSeconds: 60,
    maxAttempts: 3,
  };
  return { value, completed, failed };
}

describe("discovery consumer", () => {
  it("stores verified postings and reports counts without any text", async () => {
    const discovery = vi.fn();
    const { value, completed } = runtime(1, {
      name: "fake",
      search: async () => [
        { title: "t", url: "https://careers.sample.example/jobs/1" },
      ],
    });
    expect(
      await consumeOneDiscovery(value, { ...noopCrawlerMetrics, discovery }),
    ).toBe("completed");
    expect(completed[0]?.[2]).toEqual([
      expect.objectContaining({
        url: "https://careers.sample.example/jobs/1",
        title: "法人営業",
      }),
    ]);
    expect(discovery).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "completed",
        queries: 1,
        verified: 1,
        fetched: 1,
      }),
    );
    expect(JSON.stringify(discovery.mock.calls)).not.toMatch(
      /サンプル|careers\.sample|法人営業/,
    );
  });

  it("retries a blocked search and is idle with an empty queue", async () => {
    const { value, failed } = runtime(1, {
      name: "fake",
      search: async () => {
        throw new WebSearchError("blocked");
      },
    });
    expect(await consumeOneDiscovery(value, noopCrawlerMetrics)).toBe("retry");
    expect(failed[0]?.slice(2)).toEqual(["search_blocked", 3]);
    expect(await consumeOneDiscovery(value, noopCrawlerMetrics)).toBe("idle");
  });
});

describe("worker cycle with discovery", () => {
  const idleJobs = {
    claim: async () => null,
    renew: async () => false,
    fail: async () => false,
    requeue: async () => false,
    complete: async () => "",
  };
  const base = {
    jobStore: idleJobs,
    retentionStore: {
      loadExpiredIds: async () => [],
      clearExpiredText: async () => 0,
    },
    processor: {
      loadSource: async () => null,
      engine: { evaluate: async () => Promise.reject(new Error("unused")) },
      limits: { maxFragmentChars: 1 },
    },
    leaseSeconds: 60,
    maxAttempts: 3,
    retentionBatchSize: 10,
  };

  it("drains queued discoveries after analysis jobs, then stops", async () => {
    const { value, completed } = runtime(2, {
      name: "fake",
      search: async () => [],
    });
    const outcome = await runUntilIdle({
      cycle: () => runCrawlerCycle({ ...base, discovery: value }),
      maxJobs: 10,
      signal: new AbortController().signal,
    });
    expect(outcome).toEqual({ status: "idle", processed: 2 });
    expect(completed).toHaveLength(2);
  });

  it("does not search while an analysis job is being processed", async () => {
    const search = vi.fn(async () => []);
    const { value } = runtime(1, { name: "fake", search });
    const busy = {
      ...idleJobs,
      claim: async () => Promise.reject(new Error("analysis failed")),
    };
    await expect(
      runCrawlerCycle({ ...base, jobStore: busy, discovery: value }),
    ).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
  });
});
