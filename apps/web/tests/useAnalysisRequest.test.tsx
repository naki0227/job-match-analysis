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
