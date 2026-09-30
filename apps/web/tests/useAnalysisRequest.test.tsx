import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  useAnalysisRequest,
  type AnalysisRequestOptions,
} from "../src/features/analysis/useAnalysisRequest";
import { createQueryWrapper } from "./render-with-query";

const url = "https://jobs.example.com/1";
const jobId = "3f0c7c1e-8d2b-4a52-9c36-2f7f2f0c9a11";
const evaluationId = "8a4d1c2e-51c1-4f4e-9f7e-6c3a1b2d4e5f";
const getAccessToken = async () => "token";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderRequest(options: Partial<AnalysisRequestOptions>) {
  return renderHook(() => useAnalysisRequest({ getAccessToken, ...options }), {
    wrapper: createQueryWrapper(),
  });
}

/** Advances fake time, then lets chained fetch promises settle. */
async function flush(ms = 0) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
  await act(() => vi.advanceTimersByTimeAsync(0));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("invalid URLs are rejected before calling the API", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const { result } = renderRequest({ fetcher });
  act(() => result.current.submit("http://jobs.example.com"));
  expect(result.current.state).toEqual({
    kind: "error",
    url: "http://jobs.example.com",
    reason: "invalid_url",
  });
  expect(fetcher).not.toHaveBeenCalled();
});

test("polls a pending job through temporary outages until completion", async () => {
  const responses = [
    json({ status: "pending", jobId }, 202),
    json({ status: "running", jobId }),
    json({ code: "service_unavailable" }, 503),
    json({ status: "completed", jobId, evaluationId }),
  ];
  const fetcher = vi.fn<typeof fetch>(async () => responses.shift()!);
  const { result } = renderRequest({
    fetcher,
    pollIntervalMs: 100,
    maxPollIntervalMs: 100,
  });
  act(() => result.current.submit(` ${url} `));
  await flush(10);
  expect(result.current.state).toMatchObject({
    kind: "waiting",
    url,
    progress: "running",
  });

  await flush(100);
  expect(result.current.state).toMatchObject({ kind: "waiting" });
  await flush(100);
  expect(result.current.state).toMatchObject({
    kind: "ready",
    origin: "job",
    evaluationId,
  });

  await flush(1_000);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

test("stops polling at the deadline and reports a timeout", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
    init?.method === "POST"
      ? json({ status: "pending", jobId }, 202)
      : json({ status: "queued", jobId }),
  );
  const { result } = renderRequest({
    fetcher,
    pollIntervalMs: 100,
    maxPollIntervalMs: 100,
    timeoutMs: 350,
  });
  act(() => result.current.submit(url));
  await flush(1_000);
  expect(result.current.state).toEqual({ kind: "timeout", url, jobId });
  const callsAtTimeout = fetcher.mock.calls.length;
  await flush(1_000);
  expect(fetcher).toHaveBeenCalledTimes(callsAtTimeout);

  act(() => result.current.submit(url));
  await flush();
  expect(result.current.state).toMatchObject({ kind: "waiting" });
});

test("a missing session is reported as unauthorized", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const { result } = renderRequest({
    fetcher,
    getAccessToken: async () => {
      throw new Error("Authentication required");
    },
  });
  act(() => result.current.submit(url));
  await flush();
  expect(result.current.state).toEqual({
    kind: "error",
    url,
    reason: "unauthorized",
  });
});

test("an unreadable job stops polling with an error", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
    init?.method === "POST"
      ? json({ status: "pending", jobId }, 202)
      : json({ code: "not_found" }, 404),
  );
  const { result } = renderRequest({ fetcher, pollIntervalMs: 100 });
  act(() => result.current.submit(url));
  await flush(1_000);
  expect(result.current.state).toEqual({
    kind: "error",
    url,
    reason: "not_found",
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("reset stops polling and returns to idle", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
    init?.method === "POST"
      ? json({ status: "pending", jobId }, 202)
      : json({ status: "queued", jobId }),
  );
  const { result } = renderRequest({ fetcher, pollIntervalMs: 100 });
  act(() => result.current.submit(url));
  await flush();
  const callsBeforeReset = fetcher.mock.calls.length;
  act(() => result.current.reset());
  await flush(1_000);
  expect(result.current.state).toEqual({ kind: "idle" });
  expect(fetcher).toHaveBeenCalledTimes(callsBeforeReset);
});

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => state === "hidden",
  });
}

/** Every event a browser may fire when the user comes back to the page. */
function returnToPage() {
  setVisibility("visible");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("online"));
  });
}

afterEach(() => setVisibility("visible"));

test("a job that finished in the background shows up right after returning", async () => {
  let serverStatus = "queued";
  const gets: number[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === "POST") return json({ status: "pending", jobId }, 202);
    gets.push(Date.now());
    return serverStatus === "completed"
      ? json({ status: "completed", jobId, evaluationId })
      : json({ status: serverStatus, jobId });
  });
  const { result } = renderRequest({
    fetcher,
    pollIntervalMs: 2_000,
    maxPollIntervalMs: 10_000,
  });
  act(() => result.current.submit(url));
  await flush(10);
  expect(result.current.state).toMatchObject({ kind: "waiting" });

  setVisibility("hidden");
  const getsWhenHidden = gets.length;
  await flush(60_000);
  // The browser pauses polling in the background; the server finishes.
  expect(gets.length).toBe(getsWhenHidden);
  serverStatus = "completed";

  returnToPage();
  await flush(10);
  expect(result.current.state).toMatchObject({
    kind: "ready",
    origin: "job",
    evaluationId,
  });
  // visibilitychange, focus, pageshow and online collapse into one request.
  expect(gets.length).toBe(getsWhenHidden + 1);
});

test("a poll stuck in a dropped request is replaced instead of blocking", async () => {
  let serverStatus = "running";
  let hang = true;
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === "POST") return json({ status: "pending", jobId }, 202);
    if (hang) {
      hang = false;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }
    return serverStatus === "completed"
      ? json({ status: "completed", jobId, evaluationId })
      : json({ status: serverStatus, jobId });
  });
  const { result } = renderRequest({
    fetcher,
    pollIntervalMs: 100,
    maxPollIntervalMs: 100,
  });
  act(() => result.current.submit(url));
  await flush(10);
  serverStatus = "completed";
  // Without a return to the page, the read timeout frees the poller.
  await flush(10_500);
  expect(result.current.state).toMatchObject({ kind: "ready" });
});

test("returning after the deadline still shows a job that has finished", async () => {
  let serverStatus = "queued";
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === "POST") return json({ status: "pending", jobId }, 202);
    return serverStatus === "completed"
      ? json({ status: "completed", jobId, evaluationId })
      : json({ status: serverStatus, jobId });
  });
  const { result } = renderRequest({
    fetcher,
    pollIntervalMs: 100,
    maxPollIntervalMs: 100,
    timeoutMs: 1_000,
  });
  act(() => result.current.submit(url));
  await flush(10);
  setVisibility("hidden");
  await flush(5_000);
  expect(result.current.state).toEqual({ kind: "timeout", url, jobId });
  serverStatus = "completed";
  returnToPage();
  await flush(10);
  expect(result.current.state).toMatchObject({ kind: "ready", evaluationId });
});

test("a stale refresh also resumes when the page comes back", async () => {
  const refreshJobId = "7b1e0c2d-3f4a-4b5c-8d6e-9f0a1b2c3d4e";
  let serverStatus = "running";
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === "POST") {
      return json({
        status: "stale",
        evaluationId,
        sourceFetchedAt: "2026-09-01T00:00:00Z",
        refreshJobId,
      });
    }
    return serverStatus === "completed"
      ? json({ status: "completed", jobId: refreshJobId, evaluationId })
      : json({ status: serverStatus, jobId: refreshJobId });
  });
  const { result } = renderRequest({ fetcher, pollIntervalMs: 2_000 });
  act(() => result.current.submit(url));
  await flush(10);
  expect(result.current.state).toMatchObject({ kind: "stale" });
  setVisibility("hidden");
  await flush(30_000);
  serverStatus = "completed";
  returnToPage();
  await flush(10);
  expect(result.current.state).toMatchObject({ kind: "ready", origin: "job" });
});

test("settled jobs are not refetched when the page comes back", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
    init?.method === "POST"
      ? json({ status: "pending", jobId }, 202)
      : json({ status: "completed", jobId, evaluationId }),
  );
  const { result } = renderRequest({ fetcher, pollIntervalMs: 100 });
  act(() => result.current.submit(url));
  await flush(10);
  expect(result.current.state).toMatchObject({ kind: "ready" });
  const calls = fetcher.mock.calls.length;
  returnToPage();
  await flush(2_000);
  expect(fetcher).toHaveBeenCalledTimes(calls);
});
