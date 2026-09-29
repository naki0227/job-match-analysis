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
