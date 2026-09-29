import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AnalysisJobReadError,
  createAnalysisJobRepository,
} from "../src/repositories/analysis-jobs.js";

const jobId = randomUUID();
const evaluationId = randomUUID();

test("共有jobの公開可能な状態だけを読み取る", async () => {
  for (const status of ["queued", "running", "failed"] as const) {
    const repository = createAnalysisJobRepository(async () => ({
      status,
      evaluation_id: null,
      user_id: randomUUID(),
      worker_token: randomUUID(),
    }));
    assert.deepEqual(await repository.get(jobId), {
      status,
      evaluationId: null,
    });
  }
  const completed = createAnalysisJobRepository(async () => ({
    status: "completed",
    evaluation_id: evaluationId,
  }));
  assert.deepEqual(await completed.get(jobId), {
    status: "completed",
    evaluationId,
  });
});

test("存在しないjobと壊れたDB応答を区別し、内部詳細を隠す", async () => {
  assert.equal(
    await createAnalysisJobRepository(async () => null).get(jobId),
    null,
  );
  await assert.rejects(
    createAnalysisJobRepository(async () => ({
      status: "completed",
      evaluation_id: null,
    })).get(jobId),
    AnalysisJobReadError,
  );
  await assert.rejects(
    createAnalysisJobRepository(async () => {
      throw new Error("private database details");
    }).get(jobId),
    AnalysisJobReadError,
  );
  await assert.rejects(
    createAnalysisJobRepository(async () => null).get("invalid"),
    RangeError,
  );
});
