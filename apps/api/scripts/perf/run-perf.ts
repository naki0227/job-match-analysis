import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { serve } from "@hono/node-server";
import { careerAxisKeys } from "@job-match/contracts";
import autocannon from "autocannon";
import { Hono } from "hono";
import pg from "pg";
import { createAnalysisHistoryRoutes } from "../../src/analysis-history-routes.js";
import { createAnalysisRoutes } from "../../src/analysis-routes.js";
import type { ProfileBootstrapDeps } from "../../src/auth/profile-bootstrap.js";
import { createMatchRoutes } from "../../src/match-routes.js";
import { createHistoryPageRepository } from "../../src/repositories/analysis-history-page.js";
import { createAnalysisJobRepository } from "../../src/repositories/analysis-jobs.js";
import { createAnalysisRequestRepository } from "../../src/repositories/analysis-requests.js";
import { JOB_FACT_KINDS } from "../../src/repositories/job-facts.js";
import { createMatchRepository } from "../../src/repositories/matches.js";
import { createPendingAnalysisStore } from "../../src/repositories/pending-analysis.js";

/**
 * Issue #30: API latency against PostgreSQL with the seeded data of
 * supabase/tests/perf_seed.sql. The Supabase REST layer is replaced by one
 * SQL statement per RPC, as service_role, so the numbers are the API's own
 * work plus the database's; network to Supabase and Auth are not included.
 * Nothing external is called: no crawler, no Jev, no Supabase project.
 */
const databaseUrl = process.env.PERF_DATABASE_URL;
if (!databaseUrl) throw new Error("PERF_DATABASE_URL is required");
const durationSeconds = Number(process.env.PERF_DURATION_SECONDS ?? "5");
const connections = Number(process.env.PERF_CONNECTIONS ?? "10");

const users = {
  "1": "30000000-0000-4000-8000-000000000001",
  "20": "30000000-0000-4000-8000-000000000002",
  "100": "30000000-0000-4000-8000-000000000003",
  "1000": "30000000-0000-4000-8000-000000000004",
} as const;
const profileVersionIds: Record<string, string> = {
  [users["1"]]: "30000000-0000-4000-8000-000000000011",
  [users["20"]]: "30000000-0000-4000-8000-000000000012",
  [users["100"]]: "30000000-0000-4000-8000-000000000013",
  [users["1000"]]: "30000000-0000-4000-8000-000000000014",
};
const matchEvaluationId = "30000000-0000-4000-8000-000000000202";

// RPCs run as service_role, like the API's secret key.
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 10,
  options: "-c role=service_role",
});

const setReturning = new Map<string, boolean>();
let rpcCalls = 0;

/** One RPC as PostgREST runs it: named arguments, JSON rows or value. */
async function rpc(name: string, args: Record<string, unknown>) {
  rpcCalls += 1;
  assert.match(name, /^[a-z_0-9]+$/);
  if (!setReturning.has(name)) {
    const found = await pool.query<{ proretset: boolean }>(
      "select proretset from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace limit 1",
      [name],
    );
    setReturning.set(name, found.rows[0]?.proretset ?? false);
  }
  const keys = Object.keys(args);
  for (const key of keys) assert.match(key, /^p_[a-z_]+$/);
  const named = keys.map((key, i) => `${key} => $${i + 1}`).join(", ");
  const values = keys.map((key) => {
    const value = args[key];
    return value !== null && typeof value === "object"
      ? JSON.stringify(value)
      : value;
  });
  if (setReturning.get(name)) {
    const result = await pool.query<{ rows: unknown }>(
      `select coalesce(json_agg(r), '[]'::json) as rows from public.${name}(${named}) r`,
      values,
    );
    return result.rows[0]?.rows;
  }
  const result = await pool.query<{ value: unknown }>(
    `select public.${name}(${named}) as value`,
    values,
  );
  return result.rows[0]?.value ?? null;
}

async function readJobFacts(evaluationId: string) {
  rpcCalls += 1;
  const result = await pool.query(
    "select kind, payload from public.evaluation_job_facts where evaluation_id = $1 and kind = any($2)",
    [evaluationId, [...JOB_FACT_KINDS]],
  );
  return result.rows;
}

const auth = (): ProfileBootstrapDeps => ({
  verifyToken: async (token: string) => ({
    status: "ok",
    user: {
      id: users[token as keyof typeof users] ?? users["1"],
      hasGoogleIdentity: true,
    },
  }),
  ensureProfile: async () => true,
});

const matches = createMatchRepository(rpc, readJobFacts);

/** Server-side handler time of each request, by scenario index. */
const timings = new Map<string, number[]>();

const app = new Hono();
app.use("*", async (c, next) => {
  const started = performance.now();
  await next();
  const label = c.req.header("X-Perf-Label") ?? "other";
  const list = timings.get(label) ?? [];
  list.push(performance.now() - started);
  timings.set(label, list);
});
app.get("/health", (c) => c.json({ status: "ok" }));
app.route(
  "/",
  createAnalysisHistoryRoutes(
    auth,
    () =>
      createHistoryPageRepository((args) =>
        rpc("list_analysis_history_page_v3", args),
      ),
    () => ({ freshnessSeconds: 86_400 * 365, now: () => new Date() }),
    () =>
      createPendingAnalysisStore((args) =>
        rpc("list_unmatched_analysis_evaluations", args),
      ),
  ),
);
app.route(
  "/",
  createAnalysisRoutes(
    auth,
    () =>
      createAnalysisRequestRepository((args) =>
        rpc("request_personal_analysis_limited", args),
      ),
    () =>
      createAnalysisJobRepository(async (jobId) => {
        rpcCalls += 1;
        const result = await pool.query(
          "select status, evaluation_id from public.analysis_jobs where id = $1",
          [jobId],
        );
        return result.rows[0] ?? null;
      }),
    () => ({
      analyzerVersion: "perf-v1",
      freshnessSeconds: 86_400,
      newAnalysisLimit: 1_000_000,
      quotaWindowSeconds: 86_400,
      now: () => new Date(),
    }),
  ),
);
app.route(
  "/",
  createMatchRoutes(auth, (caller) => ({
    latestProfile: async () => ({
      profileVersionId: profileVersionIds[caller.userId]!,
      profileVersion: 1,
      profile: {
        axisCatalogVersion: 1,
        targetRoles: ["Backend Engineer"],
        axisValues: careerAxisKeys.map((axisKey) => ({
          axisKey,
          axisVersion: 1,
          preference: 50,
          importance: 50,
        })),
        constraints: { allowedPrefectureCodes: [], fullRemoteRequired: false },
      },
    }),
    readEvaluation: matches.readEvaluation,
    commitMatch: matches.commitMatch,
    readMatch: matches.readMatch,
  })),
);

const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type Scenario = {
  label: string;
  path: string;
  method?: "GET" | "POST";
  token: keyof typeof users;
  body?: string;
  /** A new body for every request (a new URL: never a cache hit). */
  freshBody?: () => string;
};

let newUrl = 0;

const scenarios: Scenario[] = [
  { label: "health", path: "/health", token: "1" },
  ...(["1", "20", "100", "1000"] as const).map((token) => ({
    label: `history (${token}件の履歴, limit=20)`,
    path: "/v1/me/analysis-history?limit=20",
    token,
  })),
  {
    label: "history (1000件の履歴, limit=100)",
    path: "/v1/me/analysis-history?limit=100",
    token: "1000",
  },
  {
    label: "解析受付（cache hit）",
    path: "/v1/analyses",
    method: "POST",
    token: "20",
    body: JSON.stringify({ url: "https://jobs.example.com/perf/cached" }),
  },
  {
    label: "解析受付（新規URL、ジョブ作成）",
    path: "/v1/analyses",
    method: "POST",
    token: "1000",
    freshBody: () =>
      JSON.stringify({ url: `https://jobs.example.com/perf/new-${newUrl++}` }),
  },
  {
    label: "match POST（保存済みを再利用）",
    path: "/v1/matches",
    method: "POST",
    token: "20",
    body: JSON.stringify({ evaluationId: matchEvaluationId }),
  },
];

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ]!;
}

const rows: string[] = [];
for (const scenario of scenarios) {
  const headers = {
    Authorization: `Bearer ${scenario.token}`,
    "Content-Type": "application/json",
    "X-Perf-Label": String(scenarios.indexOf(scenario)),
  };
  // Let the previous scenario's last requests finish, then send one request
  // alone: it checks the response and counts its RPCs.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const before = rpcCalls;
  const probe = await fetch(base + scenario.path, {
    method: scenario.method ?? "GET",
    headers,
    body: scenario.freshBody?.() ?? scenario.body,
  });
  assert.ok(
    probe.status < 300,
    `${scenario.label}: ${probe.status} ${await probe.text()}`,
  );
  await probe.arrayBuffer().catch(() => undefined);
  const rpcPerRequest = rpcCalls - before;
  timings.delete(String(scenarios.indexOf(scenario)));

  const result = await autocannon({
    url: base + scenario.path,
    method: scenario.method ?? "GET",
    headers,
    body: scenario.body,
    ...(scenario.freshBody
      ? {
          requests: [
            {
              setupRequest: (request: Record<string, unknown>) => ({
                ...request,
                body: scenario.freshBody!(),
              }),
            },
          ],
        }
      : {}),
    connections,
    duration: durationSeconds,
  });
  const server95 = percentile(
    timings.get(String(scenarios.indexOf(scenario))) ?? [0],
    95,
  );
  const errors = result.errors + result.non2xx + result.timeouts;
  rows.push(
    `| ${scenario.label} | ${result.requests.total} | ${result.requests.average.toFixed(0)} | ${result.latency.p50} | ${result.latency.p97_5} | ${server95.toFixed(1)} | ${((errors / Math.max(1, result.requests.total)) * 100).toFixed(2)}% | ${rpcPerRequest} |`,
  );
}

process.stdout.write(
  [
    `接続数 ${connections}、各${durationSeconds}秒`,
    "",
    "| シナリオ | 要求数 | req/s | client p50 (ms) | client p97.5 (ms) | server p95 (ms) | エラー率 | DB呼び出し/要求 |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n"),
);
server.close();
await pool.end();
