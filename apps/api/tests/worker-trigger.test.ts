import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createAnalysisRoutes } from "../src/analysis-routes.js";
import {
  AzureJobStartError,
  azureJobConfigFromEnv,
  createAzureJobStarter,
} from "../src/worker-trigger/azure-container-apps-job.js";
import { workerTriggerFromEnv } from "../src/worker-trigger/from-env.js";
import {
  disabledWorkerTrigger,
  throttledWorkerTrigger,
  type WorkerTriggerOutcome,
} from "../src/worker-trigger/worker-trigger.js";

const subscriptionId = randomUUID();
const env = {
  AZURE_SUBSCRIPTION_ID: subscriptionId,
  AZURE_RESOURCE_GROUP: "job-match-prod",
  CRAWLER_AZURE_JOB_NAME: "job-match-crawler",
  IDENTITY_ENDPOINT: "http://localhost:42356/msi/token",
  IDENTITY_HEADER: "identity-header-secret",
};

test("the trigger starts once per cooldown and retries after a failure", async () => {
  let clock = 0;
  let starts = 0;
  let fail = false;
  const trigger = throttledWorkerTrigger(
    async () => {
      starts += 1;
      if (fail) throw new Error("arm down");
    },
    60_000,
    () => clock,
  );
  assert.equal(await trigger.requestRun(), "started");
  assert.equal(await trigger.requestRun(), "throttled");
  clock = 60_000;
  fail = true;
  assert.equal(await trigger.requestRun(), "failed");
  fail = false;
  assert.equal(await trigger.requestRun(), "started");
  assert.equal(starts, 3);
  assert.equal(await disabledWorkerTrigger.requestRun(), "disabled");
});

test("concurrent requests share one start", async () => {
  let release = () => {};
  let starts = 0;
  const trigger = throttledWorkerTrigger(
    () =>
      new Promise<void>((resolve) => {
        starts += 1;
        release = resolve;
      }),
    1_000,
  );
  const first = trigger.requestRun();
  assert.equal(await trigger.requestRun(), "throttled");
  release();
  assert.equal(await first, "started");
  assert.equal(starts, 1);
});

test("the Azure starter uses the managed identity token and the job start API", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).startsWith(env.IDENTITY_ENDPOINT)) {
      return Response.json({
        access_token: "mi-token",
        expires_on: 4102444800,
      });
    }
    return new Response(null, { status: 202 });
  };
  const config = azureJobConfigFromEnv(env);
  assert.ok(config);
  const start = createAzureJobStarter(config, fetcher, () => 0);
  await start();
  await start();
  assert.equal(
    calls.filter((call) => call.url.includes("/msi/token")).length,
    1,
  );
  const token = new URL(calls[0]!.url);
  assert.equal(
    token.searchParams.get("resource"),
    "https://management.azure.com/",
  );
  assert.equal(
    new Headers(calls[0]!.init?.headers).get("X-IDENTITY-HEADER"),
    "identity-header-secret",
  );
  const startCall = calls[1]!;
  assert.match(
    startCall.url,
    new RegExp(
      `^https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/job-match-prod/providers/Microsoft.App/jobs/job-match-crawler/start\\?api-version=`,
    ),
  );
  assert.equal(startCall.init?.method, "POST");
  assert.equal(
    new Headers(startCall.init?.headers).get("Authorization"),
    "Bearer mi-token",
  );

  const denied = createAzureJobStarter(config, async (input) =>
    String(input).includes("/msi/token")
      ? Response.json({ access_token: "t", expires_on: 4102444800 })
      : new Response(null, { status: 403 }),
  );
  await assert.rejects(denied(), AzureJobStartError);
});

test("configuration is all-or-nothing and needs a cooldown", () => {
  assert.equal(azureJobConfigFromEnv({}), null);
  assert.equal(workerTriggerFromEnv({}), disabledWorkerTrigger);
  assert.throws(() => azureJobConfigFromEnv({ AZURE_RESOURCE_GROUP: "x" }));
  assert.throws(() =>
    azureJobConfigFromEnv({ ...env, CRAWLER_AZURE_JOB_NAME: "bad/name" }),
  );
  assert.throws(() => workerTriggerFromEnv(env));
  assert.notEqual(
    workerTriggerFromEnv({ ...env, CRAWLER_TRIGGER_COOLDOWN_SECONDS: "60" }),
    disabledWorkerTrigger,
  );
});

test("queued and stale requests wake a worker; cache hits do not", async () => {
  const outcomes: WorkerTriggerOutcome[] = [];
  let requested = 0;
  const trigger = {
    requestRun: async (): Promise<WorkerTriggerOutcome> => {
      requested += 1;
      return "started";
    },
  };
  const metrics = {
    request: () => {},
    analysisRequest: () => {},
    workerTrigger: (outcome: WorkerTriggerOutcome) => outcomes.push(outcome),
  };
  const sourceUrlId = randomUUID();
  const results = {
    fresh: {
      status: "fresh" as const,
      sourceUrlId,
      jobId: null,
      evaluationId: randomUUID(),
      sourceFetchedAt: "2026-09-29T23:00:00Z",
    },
    queued: {
      status: "queued" as const,
      sourceUrlId,
      jobId: randomUUID(),
      evaluationId: null,
      sourceFetchedAt: null,
    },
  };
  for (const result of [results.fresh, results.queued]) {
    const app = createAnalysisRoutes(
      () => ({
        verifyToken: async () => ({
          status: "ok",
          user: { id: randomUUID(), hasGoogleIdentity: true },
        }),
        ensureProfile: async () => true,
      }),
      () => ({ request: async () => result }),
      () => ({
        get: async () => ({ status: "queued" as const, evaluationId: null }),
      }),
      () => ({
        analyzerVersion: "v1",
        freshnessSeconds: 3600,
        newAnalysisLimit: 10,
        quotaWindowSeconds: 86_400,
        now: () => new Date("2026-09-30T00:00:00Z"),
      }),
      metrics,
      trigger,
    );
    await app.request("/v1/analyses", {
      method: "POST",
      headers: {
        Authorization: "Bearer t",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://jobs.example.org/1" }),
    });
    if (result === results.queued) {
      await app.request(`/v1/analyses/${result.jobId}`, {
        headers: { Authorization: "Bearer t" },
      });
    }
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requested, 2, "queued POST and queued GET, not the cache hit");
  assert.deepEqual(outcomes, ["started", "started"]);
});
