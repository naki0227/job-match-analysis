import { expect, test } from "vitest";
import {
  AnalysisApiError,
  readAnalysisJob,
  requestAnalysis,
} from "../src/features/analysis/analysis-api";

const jobId = "3f0c7c1e-8d2b-4a52-9c36-2f7f2f0c9a11";
const evaluationId = "8a4d1c2e-51c1-4f4e-9f7e-6c3a1b2d4e5f";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AnalysisApiError) return error.kind;
    throw error;
  }
  throw new Error("expected rejection");
}

test("POST sends only the URL with the bearer token", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return json({ status: "pending", jobId }, 202);
  };
  const result = await requestAnalysis(
    "token",
    "https://jobs.example.com/1",
    fetcher,
  );
  expect(result).toEqual({ status: "pending", jobId });
  expect(calls[0]?.url).toBe("/api/v1/analyses");
  expect(calls[0]?.init?.method).toBe("POST");
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
    url: "https://jobs.example.com/1",
  });
  expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe(
    "Bearer token",
  );
});

test("POST accepts cache hit and stale responses", async () => {
  const fetchedAt = "2026-09-20T01:02:03.000Z";
  await expect(
    requestAnalysis("t", "https://a.example.com", async () =>
      json({ status: "completed", evaluationId, sourceFetchedAt: fetchedAt }),
    ),
  ).resolves.toMatchObject({ status: "completed" });
  await expect(
    requestAnalysis("t", "https://a.example.com", async () =>
      json({
        status: "stale",
        evaluationId,
        sourceFetchedAt: fetchedAt,
        refreshJobId: jobId,
      }),
    ),
  ).resolves.toMatchObject({ status: "stale", refreshJobId: jobId });
});

test.each([
  [400, "invalid_url"],
  [401, "unauthorized"],
  [403, "unauthorized"],
  [429, "quota_exceeded"],
  [503, "unavailable"],
] as const)("POST maps HTTP %i to %s", async (status, kind) => {
  expect(
    await kindOf(
      requestAnalysis("t", "https://a.example.com", async () =>
        json({ code: "x", message: "internal detail", requestId: "r" }, status),
      ),
    ),
  ).toBe(kind);
});

test("network failures and contract violations are unavailable", async () => {
  expect(
    await kindOf(
      requestAnalysis("t", "https://a.example.com", async () => {
        throw new TypeError("offline");
      }),
    ),
  ).toBe("unavailable");
  expect(
    await kindOf(
      requestAnalysis("t", "https://a.example.com", async () =>
        json({ status: "completed", evaluationId }),
      ),
    ),
  ).toBe("unavailable");
});

test("GET reads the job state and rejects a mismatched job", async () => {
  let requested = "";
  const job = await readAnalysisJob("t", jobId, async (input) => {
    requested = String(input);
    return json({ status: "completed", jobId, evaluationId });
  });
  expect(requested).toBe(`/api/v1/analyses/${jobId}`);
  expect(job).toEqual({ status: "completed", jobId, evaluationId });
  expect(
    await kindOf(
      readAnalysisJob("t", jobId, async () =>
        json({ status: "running", jobId: evaluationId }),
      ),
    ),
  ).toBe("unavailable");
  expect(
    await kindOf(
      readAnalysisJob("t", jobId, async () => json({ code: "x" }, 404)),
    ),
  ).toBe("not_found");
});

test("a job read that never settles is abandoned as a temporary outage", async () => {
  // Resolves only through the abort signal, like a request dropped while
  // the browser suspended the page.
  const hanging = (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  expect(
    await kindOf(readAnalysisJob("t", jobId, hanging, undefined, 20)),
  ).toBe("unavailable");
  const parent = new AbortController();
  const read = readAnalysisJob("t", jobId, hanging, parent.signal, 60_000);
  parent.abort();
  expect(await kindOf(read)).toBe("unavailable");
});
