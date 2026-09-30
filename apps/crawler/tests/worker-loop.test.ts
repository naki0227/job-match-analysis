import { describe, expect, it, vi } from "vitest";
import { parseWorkerConfig } from "../src/worker-main.js";
import { runWorkerLoop } from "../src/worker-loop.js";

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
        CRAWLER_MAX_CANDIDATES: "16",
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
      CRAWLER_MAX_CANDIDATES: "16",
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
});
