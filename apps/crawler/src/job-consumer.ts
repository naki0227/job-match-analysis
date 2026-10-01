import { randomUUID } from "node:crypto";

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
