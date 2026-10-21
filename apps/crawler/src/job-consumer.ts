import { randomUUID } from "node:crypto";
import { SpanStatusCode, trace } from "@opentelemetry/api";

export type ClaimedAnalysisJob = {
  jobId: string;
  sourceUrlId: string;
  analyzerVersion: string;
  attempts: number;
  leaseUntil: string;
  workerToken: string;
};

export type AnalysisWork = {
  targetId: string;
  documents: unknown[];
  evaluation: unknown;
};

export interface AnalysisJobStore {
  claim(
    workerToken: string,
    leaseSeconds: number,
    maxAttempts: number,
  ): Promise<ClaimedAnalysisJob | null>;
  renew(
    jobId: string,
    workerToken: string,
    leaseSeconds: number,
  ): Promise<boolean>;
  fail(jobId: string, workerToken: string): Promise<boolean>;
  requeue(jobId: string, workerToken: string): Promise<boolean>;
  complete(
    jobId: string,
    workerToken: string,
    work: AnalysisWork,
  ): Promise<string>;
}

export class PermanentAnalysisError extends Error {
  constructor() {
    super("Analysis cannot be retried");
    this.name = "PermanentAnalysisError";
  }
}

export class AnalysisLeaseLostError extends Error {
  constructor() {
    super("Analysis job lease was lost");
    this.name = "AnalysisLeaseLostError";
  }
}

export type ConsumeResult =
  | { status: "idle" }
  | { status: "completed"; jobId: string; evaluationId: string }
  | { status: "retry_pending" | "failed" | "lease_lost"; jobId: string };

export async function consumeOneAnalysisJob(args: {
  store: AnalysisJobStore;
  leaseSeconds: number;
  maxAttempts: number;
  process: (
    job: ClaimedAnalysisJob,
    renew: () => Promise<void>,
  ) => Promise<AnalysisWork>;
}): Promise<ConsumeResult> {
  const workerToken = randomUUID();
  const job = await args.store.claim(
    workerToken,
    args.leaseSeconds,
    args.maxAttempts,
  );
  if (!job) return { status: "idle" };

  // One span per claimed job (#32), found in traces by its job ID, the same
  // ID the API returns to the user. Its database calls are child spans.
  return trace.getTracer("job-match-crawler").startActiveSpan(
    "analysis_job",
    {
      attributes: {
        "job_match.job_id": job.jobId,
        "job_match.attempt": job.attempts,
      },
    },
    async (span) => {
      try {
        const result = await processClaimed(args, job, workerToken, (name) =>
          span.setAttribute("job_match.error", name),
        );
        span.setAttribute("job_match.outcome", result.status);
        if (result.status !== "completed")
          span.setStatus({ code: SpanStatusCode.ERROR });
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

async function processClaimed(
  args: Parameters<typeof consumeOneAnalysisJob>[0],
  job: ClaimedAnalysisJob,
  workerToken: string,
  noteError: (name: string) => void,
): Promise<ConsumeResult> {
  const renew = async () => {
    if (!(await args.store.renew(job.jobId, workerToken, args.leaseSeconds))) {
      throw new AnalysisLeaseLostError();
    }
  };
  try {
    const work = await args.process(job, renew);
    const evaluationId = await args.store.complete(
      job.jobId,
      workerToken,
      work,
    );
    return { status: "completed", jobId: job.jobId, evaluationId };
  } catch (error) {
    // The error's class, never its message: messages may quote page text.
    noteError(error instanceof Error ? error.name : typeof error);
    if (error instanceof PermanentAnalysisError) {
      const failed = await args.store.fail(job.jobId, workerToken);
      return { status: failed ? "failed" : "lease_lost", jobId: job.jobId };
    }
    if (error instanceof AnalysisLeaseLostError) {
      return { status: "lease_lost", jobId: job.jobId };
    }
    // Transient failure: release the live claim immediately. Waiting for the
    // full lease made the UI appear stuck for up to ten minutes.
    if (job.attempts >= args.maxAttempts) {
      const failed = await args.store.fail(job.jobId, workerToken);
      return { status: failed ? "failed" : "lease_lost", jobId: job.jobId };
    }
    const requeued = await args.store.requeue(job.jobId, workerToken);
    return {
      status: requeued ? "retry_pending" : "lease_lost",
      jobId: job.jobId,
    };
  }
}
