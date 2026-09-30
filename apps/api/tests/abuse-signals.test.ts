import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createAnalysisRoutes } from "../src/analysis-routes.js";
import { AnalysisQuotaExceededError } from "../src/repositories/analysis-requests.js";
import {
  abuseSignalsFromEnv,
  createAbuseSignals,
  dailyKey,
  disabledAbuseSignals,
  type AbuseSignalEvent,
} from "../src/abuse/abuse-signals.js";
import {
  canonicalIp,
  clientIpSourceFromEnv,
  trustedClientIp,
} from "../src/abuse/client-ip.js";

const secret = "s".repeat(32);
const day1 = new Date("2026-09-30T23:59:59Z");
const day2 = new Date("2026-10-01T00:00:00Z");
const headers =
  (values: Record<string, string>) =>
  (name: string): string | undefined =>
    values[name];

test("daily keys are keyed HMACs that change with the UTC day", () => {
  const key = dailyKey(secret, day1, "203.0.113.7");
  assert.equal(key.length, 32);
  assert.deepEqual(key, dailyKey(secret, day1, "203.0.113.7"));
  assert.notDeepEqual(key, dailyKey(secret, day2, "203.0.113.7"));
  assert.notDeepEqual(key, dailyKey("t".repeat(32), day1, "203.0.113.7"));
  const plain = createHash("sha256").update("2026-09-30|203.0.113.7").digest();
  assert.notDeepEqual(key, plain);
});

test("IP headers are ignored unless the deployment vouches for them", () => {
  const spoofed = headers({ "X-Forwarded-For": "198.51.100.1, 203.0.113.7" });
  assert.equal(trustedClientIp(spoofed, "none"), null);
  assert.equal(trustedClientIp(spoofed, "xff-rightmost"), "203.0.113.7");
  assert.equal(trustedClientIp(headers({}), "xff-rightmost"), null);
  assert.equal(
    trustedClientIp(
      headers({ "X-Forwarded-For": "not-an-ip" }),
      "xff-rightmost",
    ),
    null,
  );
  assert.equal(clientIpSourceFromEnv(undefined), "none");
  assert.throws(() => clientIpSourceFromEnv("xff-leftmost"));
});

test("IP addresses are canonicalized before hashing", () => {
  assert.equal(canonicalIp(" 203.0.113.7 "), "203.0.113.7");
  assert.equal(canonicalIp("2001:DB8:0:0::1"), "2001:db8::1");
  assert.equal(canonicalIp("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(canonicalIp("203.0.113.7:443"), null);
});

test("only HMACs reach the store, and store failures stay silent", async () => {
  const events: AbuseSignalEvent[] = [];
  let errors = 0;
  const signals = createAbuseSignals({
    secret,
    ipSource: "xff-rightmost",
    store: {
      record: async (event) => {
        events.push(event);
      },
    },
    now: () => day1,
  });
  const req = {
    header: headers({
      "X-Forwarded-For": "203.0.113.7",
      "User-Agent": "Mozilla/5.0 Sample",
    }),
  };
  signals.record(req, "user-1", "analysis_new");
  assert.equal(events.length, 1);
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /203\.0\.113\.7|Mozilla/);
  assert.deepEqual(events[0]?.ipKey, dailyKey(secret, day1, "203.0.113.7"));

  const failing = createAbuseSignals({
    secret,
    ipSource: "none",
    store: { record: () => Promise.reject(new Error("db down")) },
    onError: () => {
      errors += 1;
    },
  });
  assert.doesNotThrow(() => failing.record(req, "user-1", "share_created"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors, 1);
});

test("signals are off without a secret and a weak secret is rejected", () => {
  assert.equal(abuseSignalsFromEnv({}), disabledAbuseSignals);
  assert.throws(() =>
    abuseSignalsFromEnv({
      ABUSE_SIGNAL_SECRET: "short",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "x",
    }),
  );
});

test("analysis routes record new work and quota rejections, not cache hits", async () => {
  const recorded: string[] = [];
  const signals = {
    record: (_req: unknown, _userId: string, type: string) => {
      recorded.push(type);
    },
  };
  const sourceUrlId = randomUUID();
  const outcomes = [
    async () => ({
      status: "fresh" as const,
      sourceUrlId,
      jobId: null,
      evaluationId: randomUUID(),
      sourceFetchedAt: "2026-09-29T23:00:00Z",
    }),
    async () => ({
      status: "queued" as const,
      sourceUrlId,
      jobId: randomUUID(),
      evaluationId: null,
      sourceFetchedAt: null,
    }),
    async () => {
      throw new AnalysisQuotaExceededError();
    },
  ];
  for (const request of outcomes) {
    const app = createAnalysisRoutes(
      () => ({
        verifyToken: async () => ({
          status: "ok",
          user: { id: randomUUID(), hasGoogleIdentity: true },
        }),
        ensureProfile: async () => true,
      }),
      () => ({ request }),
      () => ({ get: async () => null }),
      () => ({
        analyzerVersion: "v1",
        freshnessSeconds: 60,
        newAnalysisLimit: 10,
        quotaWindowSeconds: 86_400,
        now: () => day1,
      }),
      undefined,
      undefined,
      signals,
    );
    await app.request("/v1/analyses", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://jobs.example.com/a" }),
    });
  }
  assert.deepEqual(recorded, ["analysis_new", "analysis_quota_rejected"]);
});
