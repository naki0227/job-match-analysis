import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { analysisHistoryPageSchema } from "@job-match/contracts";
import { createAnalysisHistoryRoutes } from "../src/analysis-history-routes.js";
import {
  createHistoryPageRepository,
  type ReadHistoryPage,
} from "../src/repositories/analysis-history-page.js";
import { createPendingAnalysisStore } from "../src/repositories/pending-analysis.js";

const container = process.env.JOB_MATCH_DB_CONTAINER;
if (!container) throw new Error("JOB_MATCH_DB_CONTAINER is required");
const execFileAsync = promisify(execFile);
const owner = "45000000-0000-4000-8000-000000000001";
const other = "45000000-0000-4000-8000-000000000002";

function literal(value: string | number | null): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    assert.ok(Number.isSafeInteger(value));
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

async function queryJson(statement: string): Promise<unknown> {
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
  return JSON.parse(stdout.trim()) as unknown;
}

let pageCalls = 0;
let pendingCalls = 0;
const readPage: ReadHistoryPage = async (args) => {
  pageCalls += 1;
  const params = [
    args.p_user_id,
    args.p_limit,
    args.p_fresh_after,
    args.p_role,
    args.p_judgement,
    args.p_sort,
    args.p_cursor_sort_count,
    args.p_cursor_analyzed_at,
    args.p_cursor_match_result_id,
  ];
  return queryJson(`select coalesce(json_agg(row_to_json(r)
      order by r.sort_count desc, r.analyzed_at desc, r.match_result_id desc), '[]'::json)::text
    from public.list_analysis_history_page_v2(${params.map(literal).join(", ")}) r`);
};
const pending = createPendingAnalysisStore(async (args) => {
  pendingCalls += 1;
  return queryJson(`select coalesce(json_agg(json_build_object('evaluation_id', r.evaluation_id)), '[]'::json)::text
    from public.list_unmatched_analysis_evaluations(
      ${literal(args.p_user_id)}, ${literal(args.p_limit)}) r`);
});
const app = createAnalysisHistoryRoutes(
  () => ({
    verifyToken: async (token) => ({
      status: "ok",
      user: { id: token === "owner" ? owner : other, hasGoogleIdentity: true },
    }),
    ensureProfile: async () => true,
  }),
  () => createHistoryPageRepository(readPage),
  () => ({
    freshnessSeconds: 3600,
    now: () => new Date("2026-08-01T01:00:00Z"),
  }),
  () => pending,
);

async function getPage(token: string, query: string) {
  const beforePage = pageCalls;
  const beforePending = pendingCalls;
  const response = await app.request(`/v1/me/analysis-history?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(
    response.status,
    200,
    JSON.stringify({
      pageCalls: pageCalls - beforePage,
      pendingCalls: pendingCalls - beforePending,
      body: response.status === 200 ? undefined : await response.text(),
    }),
  );
  const page = analysisHistoryPageSchema.parse(await response.json());
  assert.equal(pageCalls - beforePage, 1);
  assert.equal(pendingCalls - beforePending, query.includes("cursor=") ? 0 : 1);
  return page;
}

for (const limit of [1, 20, 100]) {
  const page = await getPage("owner", `limit=${limit}`);
  assert.equal(page.items.length, limit);
  assert.ok(page.nextCursor);
  assert.ok(page.items.every((item) => item.companyName.length > 0));
}
const otherPage = await getPage("other", "limit=20");
assert.equal(otherPage.items.length, 1);
const ownerIds = new Set(
  (await getPage("owner", "limit=100")).items.map((item) => item.matchResultId),
);
assert.ok(otherPage.items.every((item) => !ownerIds.has(item.matchResultId)));

const first = await getPage("owner", "limit=20&sort=fewest_unknown");
assert.ok(first.nextCursor);
const second = await getPage(
  "owner",
  `limit=20&sort=fewest_unknown&cursor=${encodeURIComponent(first.nextCursor)}`,
);
assert.equal(second.items.length, 20);
assert.ok(
  second.items.every(
    (item) =>
      !first.items.some(
        (earlier) => earlier.matchResultId === item.matchResultId,
      ),
  ),
);
const filtered = await getPage(
  "owner",
  "role=Platform%20Engineer&judgement=has_unknown",
);
assert.equal(filtered.items.length, 1);
assert.deepEqual(filtered.items[0]?.targetRoles, ["Platform Engineer"]);

process.stdout.write(
  "History HTTP + PostgreSQL: constant RPC count, owner isolation, cursor and filters passed\n",
);
