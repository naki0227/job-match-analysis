/**
 * Starts crawler worker executions when shared analysis jobs are waiting.
 * Job state stays in PostgreSQL; a trigger only wakes a worker process.
 */
export type WorkerTriggerOutcome =
  "started" | "throttled" | "failed" | "disabled";

export type WorkerTrigger = {
  /** Never throws; the analysis response must not depend on it. */
  requestRun: () => Promise<WorkerTriggerOutcome>;
};

export const disabledWorkerTrigger: WorkerTrigger = {
  requestRun: async () => "disabled",
};

/**
 * At most one start per cooldown window. A drain-mode execution keeps
 * claiming jobs until the queue is idle, so one start serves every job that
 * arrives meanwhile; polling a still-queued job retries after the window.
 */
export function throttledWorkerTrigger(
  start: () => Promise<void>,
  cooldownMs: number,
  now: () => number = Date.now,
): WorkerTrigger {
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 1) {
    throw new RangeError("Worker trigger cooldown must be positive");
  }
  let lastStartedAt: number | null = null;
  let inFlight: Promise<WorkerTriggerOutcome> | null = null;
  return {
    requestRun() {
      if (inFlight) return Promise.resolve("throttled");
      if (lastStartedAt !== null && now() - lastStartedAt < cooldownMs) {
        return Promise.resolve("throttled");
      }
      lastStartedAt = now();
      inFlight = start()
        .then(() => "started" as const)
        .catch(() => {
          // Allow the next request to try again instead of waiting a window.
          lastStartedAt = null;
          return "failed" as const;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}
