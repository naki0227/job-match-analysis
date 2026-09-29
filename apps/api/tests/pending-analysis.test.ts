import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createPendingAnalysisStore,
  PendingAnalysisError,
} from "../src/repositories/pending-analysis.js";

test("pending evaluations are owner-scoped in one RPC and de-duplicated", async () => {
  const userId = randomUUID();
  const evaluationId = randomUUID();
  let calls = 0;
  const store = createPendingAnalysisStore(async (args) => {
    calls += 1;
    assert.deepEqual(args, { p_user_id: userId, p_limit: 20 });
    return [{ evaluation_id: evaluationId }, { evaluation_id: evaluationId }];
  });
  assert.deepEqual(await store.listUnmatched(userId, 20), [evaluationId]);
  assert.equal(calls, 1);
});

test("invalid request and malformed DB reply are rejected", async () => {
  const store = createPendingAnalysisStore(async () => [
    { evaluation_id: "bad" },
  ]);
  await assert.rejects(store.listUnmatched("bad", 20), RangeError);
  await assert.rejects(
    store.listUnmatched(randomUUID(), 20),
    PendingAnalysisError,
  );
});
