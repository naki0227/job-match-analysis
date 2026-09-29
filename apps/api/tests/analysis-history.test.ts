import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AnalysisHistoryReadError,
  createAnalysisHistoryRepository,
  type ReadAnalysisHistoryPage,
} from "../src/repositories/analysis-history.js";

const userId = randomUUID();
const companyId = randomUUID();
const analyzedAt = "2026-09-28T00:00:00+00:00";

function row(index: number) {
  return {
    job_posting_id: randomUUID(),
    match_result_id: randomUUID(),
    analyzed_at: analyzedAt,
    career_profile_version_id: randomUUID(),
    profile_version: 2,
    job_title: `Job ${index}`,
    company_id: companyId,
    company_name: "Sample Company",
    job_evaluation_id: randomUUID(),
    job_evaluated_at: analyzedAt,
    company_evaluation_id: null,
    company_evaluated_at: null,
  };
}

for (const count of [1, 20, 100]) {
  test(`${count}件の分析履歴を1回のDB呼び出しで取得する`, async () => {
    let calls = 0;
    const rows = Array.from({ length: count + 1 }, (_, index) => row(index));
    const read: ReadAnalysisHistoryPage = async (args) => {
      calls += 1;
      assert.equal(args.p_user_id, userId);
      assert.equal(args.p_limit, count);
      return rows;
    };
    const page = await createAnalysisHistoryRepository(read).listPage(
      userId,
      count,
    );
    assert.equal(calls, 1);
    assert.equal(page.items.length, count);
    assert.equal(
      page.nextCursor?.matchResultId,
      rows[count - 1]?.match_result_id,
    );
    assert.equal(page.items[0]?.profileVersion, 2);
    assert.equal(page.items[0]?.companyName, "Sample Company");
  });
}

test("次ページには直前のMatch結果をcursorとして渡す", async () => {
  const first = row(1);
  const second = row(2);
  const requests: Parameters<ReadAnalysisHistoryPage>[0][] = [];
  const repository = createAnalysisHistoryRepository(async (args) => {
    requests.push(args);
    return requests.length === 1 ? [first, second] : [second];
  });
  const page1 = await repository.listPage(userId, 1);
  const page2 = await repository.listPage(userId, 1, page1.nextCursor);
  assert.equal(page1.nextCursor?.matchResultId, first.match_result_id);
  assert.equal(requests[1]?.p_cursor_match_result_id, first.match_result_id);
  assert.equal(page2.items.length, 1);
  assert.equal(page2.nextCursor, null);
});

test("不正なuserId、limit、cursorをDBへ送らない", async () => {
  let calls = 0;
  const repository = createAnalysisHistoryRepository(async () => {
    calls += 1;
    return [];
  });
  await assert.rejects(repository.listPage("invalid", 1), RangeError);
  await assert.rejects(repository.listPage(userId, 0), RangeError);
  await assert.rejects(repository.listPage(userId, 101), RangeError);
  await assert.rejects(
    repository.listPage(userId, 1, {
      analyzedAt: "invalid",
      matchResultId: randomUUID(),
    }),
    RangeError,
  );
  assert.equal(calls, 0);
});

test("DB失敗と不正なDB応答の詳細を外へ出さない", async () => {
  const failing = createAnalysisHistoryRepository(async () => {
    throw new Error("database internal detail");
  });
  await assert.rejects(failing.listPage(userId, 1), AnalysisHistoryReadError);
  const malformed = createAnalysisHistoryRepository(async () => [
    { unexpected: true },
  ]);
  await assert.rejects(malformed.listPage(userId, 1), AnalysisHistoryReadError);
});
