import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createHistoryPageRepository,
  HistoryPageReadError,
  type ReadHistoryPage,
} from "../src/repositories/analysis-history-page.js";

const userId = randomUUID();
const analyzedAt = "2026-09-29T12:00:00Z";
const query = { limit: 20, judgement: "all" as const, sort: "recent" as const };

function row(index: number) {
  return {
    job_posting_id: randomUUID(),
    match_result_id: randomUUID(),
    analyzed_at: analyzedAt,
    career_profile_version_id: randomUUID(),
    profile_version: 2,
    target_roles: ["Backend Engineer"],
    job_title: `Sample Job ${index}`,
    company_id: randomUUID(),
    company_name: "サンプル企業",
    job_evaluation_id: randomUUID(),
    job_evaluated_at: analyzedAt,
    company_evaluation_id: null,
    company_evaluated_at: null,
    close_count: 2,
    different_count: 1,
    unknown_count: 5,
    stale_conditions: false,
    sort_count: 0,
  };
}

for (const count of [1, 20, 100]) {
  test(`${count}件の履歴を1 RPCで取得する`, async () => {
    const rows = Array.from({ length: count + 1 }, (_, index) => row(index));
    let calls = 0;
    const read: ReadHistoryPage = async (args) => {
      calls += 1;
      assert.equal(args.p_user_id, userId);
      assert.equal(args.p_limit, count);
      assert.equal(args.p_fresh_after, "2026-09-01T00:00:00Z");
      return rows;
    };
    const page = await createHistoryPageRepository(read).listPage({
      userId,
      query: { ...query, limit: count },
      freshAfter: "2026-09-01T00:00:00Z",
      cursor: null,
    });
    assert.equal(calls, 1);
    assert.equal(page.items.length, count);
    assert.deepEqual(page.items[0]?.summary, {
      close: 2,
      different: 1,
      unknown: 5,
    });
    assert.equal(
      page.nextCursor?.matchResultId,
      rows[count - 1]?.match_result_id,
    );
  });
}

test("filtered cursor is sent to the same RPC", async () => {
  let request: Parameters<ReadHistoryPage>[0] | undefined;
  const cursor = {
    sortCount: -1,
    analyzedAt,
    matchResultId: randomUUID(),
  };
  await createHistoryPageRepository(async (args) => {
    request = args;
    return [];
  }).listPage({
    userId,
    query: {
      limit: 20,
      role: "Backend Engineer",
      judgement: "has_unknown",
      sort: "fewest_unknown",
    },
    freshAfter: "2026-09-01T00:00:00Z",
    cursor,
  });
  assert.equal(request?.p_role, "Backend Engineer");
  assert.equal(request?.p_judgement, "has_unknown");
  assert.equal(request?.p_sort, "fewest_unknown");
  assert.equal(request?.p_cursor_sort_count, -1);
  assert.equal(request?.p_cursor_match_result_id, cursor.matchResultId);
});

test("DB failures and malformed rows never expose internal details", async () => {
  const input = {
    userId,
    query,
    freshAfter: "2026-09-01T00:00:00Z",
    cursor: null,
  };
  await assert.rejects(
    createHistoryPageRepository(async () => {
      throw new Error("private SQL detail");
    }).listPage(input),
    HistoryPageReadError,
  );
  await assert.rejects(
    createHistoryPageRepository(async () => [
      { ...row(1), close_count: -1 },
    ]).listPage(input),
    HistoryPageReadError,
  );
});
