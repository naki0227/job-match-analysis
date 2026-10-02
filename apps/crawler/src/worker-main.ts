import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createSupabaseAnalysisSourceStore } from "./analysis-source-store.js";
import { runCrawlerCycle } from "./crawler-cycle.js";
import { createJevDecisionEngine } from "./integrations/jev/decision-engine.js";
import { safeCrawlerMetrics } from "./crawler-metrics.js";
import { createOtelCrawlerMetrics } from "./crawler-metrics-otel.js";
import { createSupabaseAnalysisJobStore } from "./job-store.js";
import {
  createBudgetedDecisionEngine,
  createSupabaseJevBudget,
  parseJevBudgetSetting,
} from "./jev-budget.js";
import { createSupabaseSourceRetentionStore } from "./source-retention.js";
import { startTelemetry } from "./telemetry/sdk.js";
import { runUntilIdle, runWorkerLoop } from "./worker-loop.js";
import { createDdgsProvider } from "./discovery/ddgs-provider.js";
import { parseDiscoveryConfig } from "./discovery/discovery-config.js";
import { createSupabaseDiscoveryStore } from "./discovery/discovery-store.js";
import { createPublicPageFetcher } from "./fetch-source-document.js";

const configSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  JEV_API_KEY: z.string().min(1),
  CRAWLER_BROWSER_EXECUTABLE: z.string().min(1),
  CRAWLER_LEASE_SECONDS: z.coerce.number().int().min(1).max(3600),
  CRAWLER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100),
  CRAWLER_RETENTION_BATCH_SIZE: z.coerce.number().int().min(1).max(1000),
  /** Longest fragment, and so the longest stored evidence quote. */
  CRAWLER_MAX_EXCERPT_CHARS: z.coerce.number().int().positive(),
  CRAWLER_MAX_EVIDENCE_PER_AXIS: z.coerce.number().int().positive(),
  CRAWLER_POLL_INTERVAL_MS: z.coerce.number().int().positive(),
  /** loop: long-running worker. drain: exit once the queue is idle (ADR-040). */
  CRAWLER_RUN_MODE: z.enum(["loop", "drain"]).default("loop"),
  CRAWLER_DRAIN_MAX_JOBS: z.coerce.number().int().min(1).max(1000).optional(),
  /** Jev context fragments per UTC day, or "unlimited" (Issue #42). */
  CRAWLER_JEV_DAILY_CANDIDATE_BUDGET: z.string().transform((value, context) => {
    try {
      return parseJevBudgetSetting(value);
    } catch {
      context.addIssue({ code: "custom", message: "invalid Jev budget" });
      return z.NEVER;
    }
  }),
});

export function parseWorkerConfig(env: NodeJS.ProcessEnv) {
  const result = configSchema.safeParse(env);
  if (
    !result.success ||
    (result.data.CRAWLER_RUN_MODE === "drain" &&
      result.data.CRAWLER_DRAIN_MAX_JOBS === undefined)
  )
    throw new Error("Crawler worker configuration is invalid");
  return { ...result.data, discovery: parseDiscoveryConfig(env) };
}

async function main(): Promise<void> {
  const config = parseWorkerConfig(process.env);
  // Before any instrument is created; see telemetry/sdk.ts.
  const telemetry = startTelemetry("job-match-crawler");
  const browser = await chromium.launch({
    executablePath: config.CRAWLER_BROWSER_EXECUTABLE,
    headless: true,
  });
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  const sourceStore = createSupabaseAnalysisSourceStore(
    config.SUPABASE_URL,
    config.SUPABASE_SECRET_KEY,
  );
  const jobStore = createSupabaseAnalysisJobStore(
    config.SUPABASE_URL,
    config.SUPABASE_SECRET_KEY,
  );
  const retentionStore = createSupabaseSourceRetentionStore(
    config.SUPABASE_URL,
    config.SUPABASE_SECRET_KEY,
  );
  const crawlerMetrics = safeCrawlerMetrics(createOtelCrawlerMetrics());
  crawlerMetrics.jevBudgetMode(config.CRAWLER_JEV_DAILY_CANDIDATE_BUDGET.mode);
  const engine = createBudgetedDecisionEngine(
    createJevDecisionEngine({
      maxEvidencePerAxis: config.CRAWLER_MAX_EVIDENCE_PER_AXIS,
      metrics: crawlerMetrics,
    }),
    createSupabaseJevBudget(
      config.SUPABASE_URL,
      config.SUPABASE_SECRET_KEY,
      config.CRAWLER_JEV_DAILY_CANDIDATE_BUDGET,
    ),
    crawlerMetrics,
  );
  const discovery = config.discovery
    ? {
        store: createSupabaseDiscoveryStore(
          config.SUPABASE_URL,
          config.SUPABASE_SECRET_KEY,
        ),
        search: createDdgsProvider(config.discovery.ddgs),
        createFetcher: () => createPublicPageFetcher({}),
        limits: config.discovery.limits,
        leaseSeconds: config.CRAWLER_LEASE_SECONDS,
        maxAttempts: config.CRAWLER_MAX_ATTEMPTS,
      }
    : undefined;
  const cycle = () =>
    runCrawlerCycle({
      discovery,
      jobStore,
      retentionStore,
      leaseSeconds: config.CRAWLER_LEASE_SECONDS,
      maxAttempts: config.CRAWLER_MAX_ATTEMPTS,
      retentionBatchSize: config.CRAWLER_RETENTION_BATCH_SIZE,
      metrics: crawlerMetrics,
      processor: {
        loadSource: sourceStore.loadSource,
        resolveJobTarget: sourceStore.resolveJobTarget,
        engine,
        browser,
        limits: {
          maxFragmentChars: config.CRAWLER_MAX_EXCERPT_CHARS,
        },
        metrics: crawlerMetrics,
      },
    });
  try {
    if (config.CRAWLER_RUN_MODE === "drain") {
      const outcome = await runUntilIdle({
        cycle,
        maxJobs: config.CRAWLER_DRAIN_MAX_JOBS ?? 1,
        signal: controller.signal,
      });
      process.stdout.write(
        `Crawler drain finished: ${outcome.status} after ${outcome.processed} jobs\n`,
      );
      if (outcome.status === "error") process.exitCode = 1;
    } else {
      await runWorkerLoop({
        signal: controller.signal,
        pollIntervalMs: config.CRAWLER_POLL_INTERVAL_MS,
        onError: (name) =>
          process.stderr.write(`Crawler cycle failed: ${name}\n`),
        cycle,
      });
    }
  } finally {
    await browser.close();
    // Drain runs exit right after this; flush so the run is observable.
    await telemetry.shutdown();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    const name = error instanceof Error ? error.name : "UnknownError";
    process.stderr.write(`Crawler worker stopped: ${name}\n`);
    process.exitCode = 1;
  });
}
