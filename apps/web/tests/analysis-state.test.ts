import { expect, test } from "vitest";
import {
  applyJobUpdate,
  expirePolling,
  failPolling,
  pollingJobId,
  stateFromPost,
} from "../src/features/analysis/analysis-state";

const url = "https://jobs.example.com/1";
const jobId = "3f0c7c1e-8d2b-4a52-9c36-2f7f2f0c9a11";
const otherJobId = "0c1e9a11-8d2b-4a52-9c36-2f7f2f0c3f7f";
const evaluationId = "8a4d1c2e-51c1-4f4e-9f7e-6c3a1b2d4e5f";
const newEvaluationId = "6c3a1b2d-51c1-4f4e-9f7e-8a4d1c2e4e5f";
const fetchedAt = "2026-09-20T01:02:03.000Z";

test("200 completed is a cache hit and needs no polling", () => {
  const state = stateFromPost(url, {
    status: "completed",
    evaluationId,
    sourceFetchedAt: fetchedAt,
  });
  expect(state).toEqual({
    kind: "ready",
    url,
    evaluationId,
    origin: "cache",
    sourceFetchedAt: fetchedAt,
  });
  expect(pollingJobId(state)).toBeNull();
});

test("202 pending polls the shared job until completion", () => {
  const waiting = stateFromPost(url, { status: "pending", jobId });
  expect(pollingJobId(waiting)).toBe(jobId);
  const running = applyJobUpdate(waiting, { status: "running", jobId });
  expect(running).toMatchObject({ kind: "waiting", progress: "running" });
  expect(
    applyJobUpdate(running, { status: "completed", jobId, evaluationId }),
  ).toEqual({
    kind: "ready",
    url,
    evaluationId,
    origin: "job",
    sourceFetchedAt: null,
  });
});

test("failed job and polling timeout are distinct outcomes", () => {
  const waiting = stateFromPost(url, { status: "pending", jobId });
  expect(applyJobUpdate(waiting, { status: "failed", jobId })).toEqual({
    kind: "failed",
    url,
    jobId,
  });
  expect(expirePolling(waiting, jobId)).toEqual({
    kind: "timeout",
    url,
    jobId,
  });
});

test("stale keeps the old evaluation while its refresh runs", () => {
  const stale = stateFromPost(url, {
    status: "stale",
    evaluationId,
    sourceFetchedAt: fetchedAt,
    refreshJobId: jobId,
  });
  expect(pollingJobId(stale)).toBe(jobId);
  const failed = applyJobUpdate(stale, { status: "failed", jobId });
  expect(failed).toMatchObject({
    kind: "stale",
    evaluationId,
    refresh: "failed",
  });
  expect(pollingJobId(failed)).toBeNull();
  expect(
    applyJobUpdate(stale, {
      status: "completed",
      jobId,
      evaluationId: newEvaluationId,
    }),
  ).toMatchObject({ kind: "ready", evaluationId: newEvaluationId });
  expect(expirePolling(stale, jobId)).toMatchObject({
    kind: "stale",
    refresh: "timeout",
  });
});

test("updates for another job are ignored", () => {
  const waiting = stateFromPost(url, { status: "pending", jobId });
  expect(applyJobUpdate(waiting, { status: "failed", jobId: otherJobId })).toBe(
    waiting,
  );
  expect(expirePolling(waiting, otherJobId)).toBe(waiting);
  expect(failPolling(waiting, otherJobId, "not_found")).toBe(waiting);
});

test("unreadable jobs become errors, but stale evaluations survive", () => {
  const waiting = stateFromPost(url, { status: "pending", jobId });
  expect(failPolling(waiting, jobId, "not_found")).toEqual({
    kind: "error",
    url,
    reason: "not_found",
  });
  const stale = stateFromPost(url, {
    status: "stale",
    evaluationId,
    sourceFetchedAt: fetchedAt,
    refreshJobId: jobId,
  });
  expect(failPolling(stale, jobId, "unauthorized")).toMatchObject({
    kind: "stale",
    refresh: "failed",
  });
});
