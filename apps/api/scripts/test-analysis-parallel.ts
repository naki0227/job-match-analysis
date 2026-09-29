import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createAnalysisRoutes } from "../src/analysis-routes.js";
import { createAnalysisRequestRepository } from "../src/repositories/analysis-requests.js";

const execFileAsync = promisify(execFile);
const container = process.env.JOB_MATCH_DB_CONTAINER;
if (!container) throw new Error("JOB_MATCH_DB_CONTAINER is required");

const users = [
  "32000000-0000-4000-8000-000000000001",
  "32000000-0000-4000-8000-000000000002",
] as const;
const rawUrls = [
  "https://example.org/issue19-http?utm_source=test#top",
  "https://example.org/issue19-http",
] as const;
const normalizedUrl = "https://example.org/issue19-http";
const sql = (userId: string, rawUrl: string) =>
  `select row_to_json(r)::text from public.request_personal_analysis(
    '${userId}', '${rawUrl}', '${normalizedUrl}',
    'issue19-http-v1', '2026-09-27T00:00:00Z') r`;

async function query(statement: string): Promise<string> {
  const { stdout } = await execFileAsync("docker", [
    "exec",
    container!,
    "psql",
    "-X",
    "-q",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-c",
    statement,
  ]);
  return stdout.trim();
}

// All HTTP requests begin together; bound only the local docker/psql processes.
let active = 0;
const waiters: Array<() => void> = [];
async function withDbSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= 20) await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
  try {
    return await run();
  } finally {
    active -= 1;
    waiters.shift()?.();
  }
}

const repository = createAnalysisRequestRepository(async (args) => {
  assert.equal(args.p_normalized_url, normalizedUrl);
  assert.equal(args.p_analyzer_version, "issue19-http-v1");
  assert.ok(users.includes(args.p_user_id as (typeof users)[number]));
  assert.ok(rawUrls.includes(args.p_raw_url as (typeof rawUrls)[number]));
  const value = await withDbSlot(() =>
    query(sql(args.p_user_id, args.p_raw_url)),
  );
  return [JSON.parse(value) as unknown];
});

const routes = createAnalysisRoutes(
  () => ({
    verifyToken: async (token) => ({
      status: "ok",
      user: {
        id: token === "user-a" ? users[0] : users[1],
        hasGoogleIdentity: true,
      },
    }),
    ensureProfile: async () => true,
  }),
  () => repository,
  () => ({ get: async () => null }),
  () => ({
    analyzerVersion: "issue19-http-v1",
    freshnessSeconds: 3600,
    now: () => new Date("2026-09-29T02:00:00Z"),
  }),
);

const responses = await Promise.all(
  Array.from({ length: 100 }, (_, index) =>
    routes.request("/v1/analyses", {
      method: "POST",
      headers: {
        Authorization: index % 2 === 0 ? "Bearer user-a" : "Bearer user-b",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: rawUrls[index % 2] }),
    }),
  ),
);
assert.ok(responses.every((response) => response.status === 202));
const bodies = await Promise.all(responses.map((response) => response.json()));
const jobIds = new Set(
  bodies.map((body: unknown) => {
    assert.ok(typeof body === "object" && body !== null && "jobId" in body);
    return body.jobId;
  }),
);
assert.equal(jobIds.size, 1);
assert.equal(
  await query(`select count(*) from public.analysis_jobs j
    join public.source_urls s on s.id = j.source_url_id
    where s.normalized_url = '${normalizedUrl}'
      and j.analyzer_version = 'issue19-http-v1'
      and j.status in ('queued', 'running')`),
  "1",
);
assert.equal(
  await query(`select count(*) from public.user_analysis_requests r
    join public.source_urls s on s.id = r.source_url_id
    where s.normalized_url = '${normalizedUrl}'`),
  "2",
);
process.stdout.write("100 concurrent HTTP analysis requests shared one job\n");
