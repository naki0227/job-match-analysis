import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createSupabaseAnalysisSourceStore } from "./analysis-source-store.js";
import { runCrawlerCycle } from "./crawler-cycle.js";
import { createJevDecisionEngine } from "./integrations/jev/decision-engine.js";
import { createSupabaseAnalysisJobStore } from "./job-store.js";
import {
  createBudgetedDecisionEngine,
  createSupabaseJevBudget,
  parseJevBudgetSetting,
} from "./jev-budget.js";
import { createSupabaseSourceRetentionStore } from "./source-retention.js";
import { runWorkerLoop } from "./worker-loop.js";

const configSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  JEV_API_KEY: z.string().min(1),
  CRAWLER_BROWSER_EXECUTABLE: z.string().min(1),
  CRAWLER_LEASE_SECONDS: z.coerce.number().int().min(1).max(3600),
  CRAWLER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100),
  CRAWLER_RETENTION_BATCH_SIZE: z.coerce.number().int().min(1).max(1000),
  CRAWLER_MAX_CANDIDATES: z.coerce.number().int().positive(),
  CRAWLER_MAX_EXCERPT_CHARS: z.coerce.number().int().positive(),
  CRAWLER_POLL_INTERVAL_MS: z.coerce.number().int().positive(),
  /** Jev evidence candidates per UTC day, or "unlimited" (Issue #42). */
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
  if (!result.success)
    throw new Error("Crawler worker configuration is invalid");
  return result.data;
}

async function main(): Promise<void> {
  const config = parseWorkerConfig(process.env);
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
  const engine = createBudgetedDecisionEngine(
    createJevDecisionEngine({
      maxCandidates: config.CRAWLER_MAX_CANDIDATES,
      maxExcerptChars: config.CRAWLER_MAX_EXCERPT_CHARS,
    }),
    createSupabaseJevBudget(
      config.SUPABASE_URL,
      config.SUPABASE_SECRET_KEY,
      config.CRAWLER_JEV_DAILY_CANDIDATE_BUDGET,
    ),
  );
  try {
    await runWorkerLoop({
      signal: controller.signal,
      pollIntervalMs: config.CRAWLER_POLL_INTERVAL_MS,
      onError: (name) =>
        process.stderr.write(`Crawler cycle failed: ${name}\n`),
      cycle: () =>
        runCrawlerCycle({
          jobStore,
          retentionStore,
          leaseSeconds: config.CRAWLER_LEASE_SECONDS,
          maxAttempts: config.CRAWLER_MAX_ATTEMPTS,
          retentionBatchSize: config.CRAWLER_RETENTION_BATCH_SIZE,
          processor: {
            loadSource: sourceStore.loadSource,
            resolveJobTarget: sourceStore.resolveJobTarget,
            engine,
            browser,
            maxCandidates: config.CRAWLER_MAX_CANDIDATES,
            maxExcerptChars: config.CRAWLER_MAX_EXCERPT_CHARS,
          },
        }),
    });
  } finally {
    await browser.close();
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
