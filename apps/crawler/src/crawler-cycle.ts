import { noopCrawlerMetrics, type CrawlerMetrics } from "./crawler-metrics.js";
import {
  consumeOneDiscovery,
  type DiscoveryOutcome,
  type DiscoveryRuntime,
} from "./discovery/consume-discovery.js";
import {
  consumeOneAnalysisJob,
  type AnalysisJobStore,
  type ConsumeResult,
} from "./job-consumer.js";
import {
  processAnalysisJob,
  type AnalysisProcessorDeps,
} from "./process-analysis-job.js";
import {
  clearExpiredSourceText,
  type SourceRetentionStore,
} from "./source-retention.js";

export async function runCrawlerCycle(args: {
  jobStore: AnalysisJobStore;
  retentionStore: SourceRetentionStore;
  processor: AnalysisProcessorDeps;
  leaseSeconds: number;
  maxAttempts: number;
  retentionBatchSize: number;
  now?: () => Date;
  metrics?: CrawlerMetrics;
  /** Web discovery (ADR-047); runs only when no analysis job is waiting. */
  discovery?: DiscoveryRuntime;
}): Promise<{
  clearedSourceTexts: number;
  analysis: ConsumeResult;
  discovery: DiscoveryOutcome;
}> {
  const clearedSourceTexts = await clearExpiredSourceText({
    store: args.retentionStore,
    now: args.now?.() ?? new Date(),
    batchSize: args.retentionBatchSize,
  });
  const metrics = args.metrics ?? noopCrawlerMetrics;
  const started = performance.now();
  let analysis: ConsumeResult;
  try {
    analysis = await consumeOneAnalysisJob({
      store: args.jobStore,
      leaseSeconds: args.leaseSeconds,
      maxAttempts: args.maxAttempts,
      process: (job, renew) => processAnalysisJob(job, renew, args.processor),
    });
  } catch (error) {
    metrics.analysisJob({
      outcome: "error",
      durationMs: performance.now() - started,
    });
    throw error;
  }
  if (analysis.status !== "idle") {
    metrics.analysisJob({
      outcome: analysis.status,
      durationMs: performance.now() - started,
    });
  }
  // Analysis users are waiting on a page; discovery goes after them.
  const discovery =
    args.discovery && analysis.status === "idle"
      ? await consumeOneDiscovery(args.discovery, metrics, args.now)
      : "idle";
  return { clearedSourceTexts, analysis, discovery };
}
