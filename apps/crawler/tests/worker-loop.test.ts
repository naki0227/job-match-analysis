import { describe, expect, it, vi } from "vitest";
import { parseWorkerConfig } from "../src/worker-main.js";
import { runUntilIdle, runWorkerLoop } from "../src/worker-loop.js";

describe("worker runtime", () => {
  it("requires explicit resource and polling settings without echoing secrets", () => {
    expect(() =>
      parseWorkerConfig({ JEV_API_KEY: "private-test-key" }),
    ).toThrow("Crawler worker configuration is invalid");
    expect(
      parseWorkerConfig({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "secret",
        JEV_API_KEY: "private-test-key",
        CRAWLER_BROWSER_EXECUTABLE: "/usr/bin/chromium",
        CRAWLER_LEASE_SECONDS: "60",
        CRAWLER_MAX_ATTEMPTS: "2",
        CRAWLER_RETENTION_BATCH_SIZE: "100",
        CRAWLER_JEV_MAX_FRAGMENTS: "60",
        CRAWLER_JEV_MAX_CONTEXT_CHARS: "12000",
        CRAWLER_MAX_EVIDENCE_PER_AXIS: "3",
        CRAWLER_MAX_EXCERPT_CHARS: "120",
        CRAWLER_POLL_INTERVAL_MS: "1000",
        CRAWLER_JEV_DAILY_CANDIDATE_BUDGET: "500",
      }).CRAWLER_LEASE_SECONDS,
    ).toBe(60);
    const base = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "secret",
      JEV_API_KEY: "private-test-key",
      CRAWLER_BROWSER_EXECUTABLE: "/usr/bin/chromium",
      CRAWLER_LEASE_SECONDS: "60",
      CRAWLER_MAX_ATTEMPTS: "2",
      CRAWLER_RETENTION_BATCH_SIZE: "100",
      CRAWLER_JEV_MAX_FRAGMENTS: "60",
      CRAWLER_JEV_MAX_CONTEXT_CHARS: "12000",
      CRAWLER_MAX_EVIDENCE_PER_AXIS: "3",
      CRAWLER_MAX_EXCERPT_CHARS: "120",
      CRAWLER_POLL_INTERVAL_MS: "1000",
    };
    expect(
      parseWorkerConfig({
        ...base,
        CRAWLER_JEV_DAILY_CANDIDATE_BUDGET: "unlimited",
      }).CRAWLER_JEV_DAILY_CANDIDATE_BUDGET,
    ).toEqual({ mode: "unlimited" });
    for (const budget of [undefined, "0", "-5", "infinite"]) {
      expect(() =>
        parseWorkerConfig({
          ...base,
          CRAWLER_JEV_DAILY_CANDIDATE_BUDGET: budget,
        }),
      ).toThrow("Crawler worker configuration is invalid");
    }
  });

  it("continues after a cycle error and stops on abort", async () => {
    const controller = new AbortController();
    const cycle = vi
      .fn()
      .mockRejectedValueOnce(new Error("private failure details"))
      .mockImplementationOnce(async () => controller.abort());
    const onError = vi.fn();
    await runWorkerLoop({
      cycle,
      signal: controller.signal,
      pollIntervalMs: 1,
      onError,
      pause: async () => undefined,
    });
    expect(cycle).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith("Error");
    expect(JSON.stringify(onError.mock.calls)).not.toContain(
      "private failure details",
    );
  });

  it("drain mode stops when the queue is idle, at the cap, or on error", async () => {
    const statuses = ["completed", "failed", "idle"];
    const idle = await runUntilIdle({
      cycle: async () => ({ analysis: { status: statuses.shift()! } }),
      maxJobs: 10,
      signal: new AbortController().signal,
    });
    expect(idle).toEqual({ status: "idle", processed: 2 });

    const capped = await runUntilIdle({
      cycle: async () => ({ analysis: { status: "completed" } }),
      maxJobs: 3,
      signal: new AbortController().signal,
    });
    expect(capped).toEqual({ status: "limit_reached", processed: 3 });

    const failing = await runUntilIdle({
      cycle: async () => {
        throw new TypeError("private failure details");
      },
      maxJobs: 3,
      signal: new AbortController().signal,
    });
    expect(failing).toEqual({
      status: "error",
      processed: 0,
      errorName: "TypeError",
    });

    const controller = new AbortController();
    controller.abort();
    expect(
      await runUntilIdle({
        cycle: vi.fn(),
        maxJobs: 3,
        signal: controller.signal,
      }),
    ).toEqual({ status: "aborted", processed: 0 });
    await expect(
      runUntilIdle({ cycle: vi.fn(), maxJobs: 0, signal: controller.signal }),
    ).rejects.toThrow(RangeError);
  });

  it("drain mode requires an explicit per-run job cap", () => {
    const base = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "secret",
      JEV_API_KEY: "private-test-key",
      CRAWLER_BROWSER_EXECUTABLE: "/usr/bin/chromium",
      CRAWLER_LEASE_SECONDS: "60",
      CRAWLER_MAX_ATTEMPTS: "2",
      CRAWLER_RETENTION_BATCH_SIZE: "100",
      CRAWLER_JEV_MAX_FRAGMENTS: "60",
      CRAWLER_JEV_MAX_CONTEXT_CHARS: "12000",
      CRAWLER_MAX_EVIDENCE_PER_AXIS: "3",
      CRAWLER_MAX_EXCERPT_CHARS: "120",
      CRAWLER_POLL_INTERVAL_MS: "1000",
      CRAWLER_JEV_DAILY_CANDIDATE_BUDGET: "unlimited",
    };
    expect(parseWorkerConfig(base).CRAWLER_RUN_MODE).toBe("loop");
    expect(() =>
      parseWorkerConfig({ ...base, CRAWLER_RUN_MODE: "drain" }),
    ).toThrow("Crawler worker configuration is invalid");
    expect(
      parseWorkerConfig({
        ...base,
        CRAWLER_RUN_MODE: "drain",
        CRAWLER_DRAIN_MAX_JOBS: "20",
      }).CRAWLER_DRAIN_MAX_JOBS,
    ).toBe(20);
  });
});
