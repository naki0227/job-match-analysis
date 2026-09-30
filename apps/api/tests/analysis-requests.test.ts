import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AnalysisQuotaExceededError,
  AnalysisRequestError,
  createAnalysisRequestRepository,
} from "../src/repositories/analysis-requests.js";

const sourceUrlId = randomUUID();
const jobId = randomUUID();
const evaluationId = randomUUID();
const freshAfter = "2026-09-29T00:00:00Z";
const input = {
  userId: randomUUID(),
  rawUrl: "https://example.org/jobs/123?utm_source=mail",
  normalizedUrl: "https://example.org/jobs/123",
  analyzerVersion: "v1",
  freshAfter,
  quotaSince: "2026-09-28T00:00:00Z",
  newAnalysisLimit: 5,
};

test("受付を1 RPCで行い、rawとnormalized URLを分けて渡す", async () => {
  let calls = 0;
  const repository = createAnalysisRequestRepository(async (args) => {
    calls += 1;
    assert.equal(args.p_user_id, input.userId);
    assert.equal(args.p_raw_url, input.rawUrl);
    assert.equal(args.p_normalized_url, input.normalizedUrl);
    assert.equal(args.p_fresh_after, freshAfter);
    assert.equal(args.p_quota_since, input.quotaSince);
    assert.equal(args.p_new_analysis_limit, 5);
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
  const missingDate = createAnalysisRequestRepository(async () => [
    {
      request_status: "fresh",
      source_url_id: sourceUrlId,
      job_id: null,
      evaluation_id: evaluationId,
      source_fetched_at: null,
    },
  ]);
  await assert.rejects(missingDate.request(input), AnalysisRequestError);
});

test("上限超過は専用エラーで伝え、不正な上限値はRPC前に拒否する", async () => {
  const quota = createAnalysisRequestRepository(async () => {
    throw new AnalysisQuotaExceededError();
  });
  await assert.rejects(quota.request(input), AnalysisQuotaExceededError);
  let called = false;
  const guarded = createAnalysisRequestRepository(async () => {
    called = true;
    return [];
  });
  for (const bad of [
    { newAnalysisLimit: 0 },
    { newAnalysisLimit: 1.5 },
    { quotaSince: "yesterday" },
  ]) {
    await assert.rejects(guarded.request({ ...input, ...bad }), RangeError);
  }
  assert.equal(called, false);
});
