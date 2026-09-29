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
}): Promise<{ clearedSourceTexts: number; analysis: ConsumeResult }> {
  const clearedSourceTexts = await clearExpiredSourceText({
    store: args.retentionStore,
    now: args.now?.() ?? new Date(),
    batchSize: args.retentionBatchSize,
  });
  const analysis = await consumeOneAnalysisJob({
    store: args.jobStore,
    leaseSeconds: args.leaseSeconds,
    maxAttempts: args.maxAttempts,
    process: (job, renew) => processAnalysisJob(job, renew, args.processor),
  });
  return { clearedSourceTexts, analysis };
}
