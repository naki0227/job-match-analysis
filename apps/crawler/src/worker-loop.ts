export async function runWorkerLoop(args: {
  cycle: () => Promise<unknown>;
  pollIntervalMs: number;
  signal: AbortSignal;
  onError: (errorName: string) => void;
  pause?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  if (!Number.isSafeInteger(args.pollIntervalMs) || args.pollIntervalMs < 1)
    throw new RangeError("Invalid worker poll interval");
  const pause =
    args.pause ??
    ((ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        }
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      }));
  while (!args.signal.aborted) {
    try {
      await args.cycle();
    } catch (error) {
      args.onError(error instanceof Error ? error.name : "UnknownError");
    }
    if (!args.signal.aborted) await pause(args.pollIntervalMs, args.signal);
  }
}

export type DrainOutcome =
  | { status: "idle"; processed: number }
  | { status: "limit_reached"; processed: number }
  | { status: "aborted"; processed: number }
  | { status: "error"; processed: number; errorName: string };

/**
 * One run of a short-lived worker (Azure Container Apps Job, ADR-040): claim
 * jobs until the PostgreSQL queue is idle or the per-run cap is hit, then
 * return so the process can exit. Job state stays in PostgreSQL; a failed
 * cycle stops the run and its lease lets a later run retry the job.
 */
export async function runUntilIdle(args: {
  cycle: () => Promise<{ analysis: { status: string } }>;
  maxJobs: number;
  signal: AbortSignal;
}): Promise<DrainOutcome> {
  if (!Number.isSafeInteger(args.maxJobs) || args.maxJobs < 1)
    throw new RangeError("Invalid drain limit");
  let processed = 0;
  while (processed < args.maxJobs) {
    if (args.signal.aborted) return { status: "aborted", processed };
    let result: { analysis: { status: string } };
    try {
      result = await args.cycle();
    } catch (error) {
      return {
        status: "error",
        processed,
        errorName: error instanceof Error ? error.name : "UnknownError",
      };
    }
    if (result.analysis.status === "idle") return { status: "idle", processed };
    processed += 1;
  }
  return { status: "limit_reached", processed };
}
