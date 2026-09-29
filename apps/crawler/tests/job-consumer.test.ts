import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AnalysisLeaseLostError,
  consumeOneAnalysisJob,
  PermanentAnalysisError,
  type AnalysisJobStore,
  type AnalysisWork,
} from "../src/job-consumer.js";
import {
  AnalysisJobStoreError,
  createAnalysisJobStore,
} from "../src/job-store.js";

const jobId = randomUUID();
const sourceUrlId = randomUUID();
const evaluationId = randomUUID();
const targetId = randomUUID();
const work: AnalysisWork = { targetId, documents: [], evaluation: {} };

function fakeStore(): AnalysisJobStore {
  return {
    claim: vi.fn(async (workerToken) => ({
      jobId,
      sourceUrlId,
      analyzerVersion: "v1",
      attempts: 1,
      leaseUntil: "2026-09-29T12:00:00Z",
      workerToken,
    })),
    renew: vi.fn(async () => true),
    fail: vi.fn(async () => true),
    complete: vi.fn(async () => evaluationId),
  };
}

describe("analysis job consumer", () => {
  it("空キューではprocessorを呼ばない", async () => {
    const store = fakeStore();
    store.claim = vi.fn(async () => null);
    const process = vi.fn(async () => work);
    expect(
      await consumeOneAnalysisJob({
        store,
        leaseSeconds: 60,
        maxAttempts: 3,
        process,
      }),
    ).toEqual({ status: "idle" });
    expect(process).not.toHaveBeenCalled();
  });

  it("claim tokenでleaseを更新し、評価を原子的RPCに渡す", async () => {
    const store = fakeStore();
    const result = await consumeOneAnalysisJob({
      store,
      leaseSeconds: 60,
      maxAttempts: 3,
      process: async (job, renew) => {
        expect(job.workerToken).toMatch(/^[0-9a-f-]{36}$/);
        await renew();
        return work;
      },
    });
    expect(result).toEqual({ status: "completed", jobId, evaluationId });
    expect(store.renew).toHaveBeenCalledWith(jobId, expect.any(String), 60);
    expect(store.complete).toHaveBeenCalledWith(
      jobId,
      expect.any(String),
      work,
    );
    expect(store.fail).not.toHaveBeenCalled();
  });

  it("一時失敗はlease満了まで保持し、恒久失敗はfailedにする", async () => {
    const transientStore = fakeStore();
    const transient = await consumeOneAnalysisJob({
      store: transientStore,
      leaseSeconds: 60,
      maxAttempts: 3,
      process: async () => {
        throw new Error("temporary external failure");
      },
    });
    expect(transient).toEqual({ status: "retry_pending", jobId });
    expect(transientStore.fail).not.toHaveBeenCalled();
    const permanentStore = fakeStore();
    const permanent = await consumeOneAnalysisJob({
      store: permanentStore,
      leaseSeconds: 60,
      maxAttempts: 3,
      process: async () => {
        throw new PermanentAnalysisError();
      },
    });
    expect(permanent).toEqual({ status: "failed", jobId });
    expect(permanentStore.fail).toHaveBeenCalledWith(jobId, expect.any(String));
  });

  it("更新時にleaseを失ったら評価を確定しない", async () => {
    const store = fakeStore();
    store.renew = vi.fn(async () => false);
    const result = await consumeOneAnalysisJob({
      store,
      leaseSeconds: 60,
      maxAttempts: 3,
      process: async (_job, renew) => {
        await renew();
        return work;
      },
    });
    expect(result).toEqual({ status: "lease_lost", jobId });
    expect(store.complete).not.toHaveBeenCalled();
  });
});

describe("Supabase job store adapter", () => {
  it("claim、renew、completeを各1 RPCに変換する", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_analysis_job")
        return {
          data: [
            {
              job_id: jobId,
              source_url_id: sourceUrlId,
              analyzer_version: "v1",
              attempts: 1,
              lease_until: "2026-09-29T12:00:00Z",
            },
          ],
          error: null,
        };
      if (name === "renew_analysis_job_lease")
        return { data: true, error: null };
      return { data: evaluationId, error: null };
    });
    const store = createAnalysisJobStore({ rpc });
    expect((await store.claim(randomUUID(), 60, 3))?.jobId).toBe(jobId);
    expect(await store.renew(jobId, randomUUID(), 60)).toBe(true);
    expect(await store.complete(jobId, randomUUID(), work)).toBe(evaluationId);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("DB内部エラーを隠し、claim競合のみlease喪失として扱う", async () => {
    const unavailable = createAnalysisJobStore({
      rpc: async () => ({ data: null, error: { code: "XX000" } }),
    });
    await expect(unavailable.claim(randomUUID(), 60, 3)).rejects.toBeInstanceOf(
      AnalysisJobStoreError,
    );
    const lost = createAnalysisJobStore({
      rpc: async () => ({ data: null, error: { code: "40001" } }),
    });
    await expect(
      lost.complete(jobId, randomUUID(), work),
    ).rejects.toBeInstanceOf(AnalysisLeaseLostError);
  });
});
