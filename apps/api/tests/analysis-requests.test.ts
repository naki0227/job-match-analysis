import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AnalysisRequestError,
  createAnalysisRequestRepository,
} from "../src/repositories/analysis-requests.js";

const sourceUrlId = randomUUID();
const jobId = randomUUID();
const evaluationId = randomUUID();
const freshAfter = "2026-09-29T00:00:00Z";
const input = {
  rawUrl: "https://example.org/jobs/123?utm_source=mail",
  normalizedUrl: "https://example.org/jobs/123",
  analyzerVersion: "v1",
  freshAfter,
};

test("受付を1 RPCで行い、rawとnormalized URLを分けて渡す", async () => {
  let calls = 0;
  const repository = createAnalysisRequestRepository(async (args) => {
    calls += 1;
    assert.equal(args.p_raw_url, input.rawUrl);
    assert.equal(args.p_normalized_url, input.normalizedUrl);
    assert.equal(args.p_fresh_after, freshAfter);
    return [
      {
        request_status: "queued",
        source_url_id: sourceUrlId,
        job_id: jobId,
        evaluation_id: null,
        source_fetched_at: null,
      },
    ];
  });
  assert.deepEqual(await repository.request(input), {
    status: "queued",
    sourceUrlId,
    jobId,
    evaluationId: null,
    sourceFetchedAt: null,
  });
  assert.equal(calls, 1);
});

test("freshとstaleの評価版を区別する", async () => {
  for (const status of ["fresh", "stale"] as const) {
    const repository = createAnalysisRequestRepository(async () => [
      {
        request_status: status,
        source_url_id: sourceUrlId,
        job_id: status === "fresh" ? null : jobId,
        evaluation_id: evaluationId,
        source_fetched_at: freshAfter,
      },
    ]);
    const result = await repository.request(input);
    assert.equal(result.status, status);
    assert.equal(result.evaluationId, evaluationId);
  }
});

test("不正な入力とDB応答を拒否し、内部エラーを公開しない", async () => {
  let calls = 0;
  const repository = createAnalysisRequestRepository(async () => {
    calls += 1;
    return [];
  });
  await assert.rejects(
    repository.request({ ...input, normalizedUrl: "http://internal" }),
    RangeError,
  );
  assert.equal(calls, 0);
  await assert.rejects(repository.request(input), AnalysisRequestError);
  const failing = createAnalysisRequestRepository(async () => {
    throw new Error("internal database detail");
  });
  await assert.rejects(failing.request(input), AnalysisRequestError);
});
