import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createSavedJobsRepository,
  SavedJobsReadError,
  type ReadSavedJobsPage,
} from "../src/repositories/saved-jobs.js";

const userId = randomUUID();
const companyId = randomUUID();
const savedAt = "2026-09-28T00:00:00+00:00";

function row(index: number) {
  return {
    job_posting_id: randomUUID(),
    saved_at: savedAt,
    job_title: `Job ${index}`,
    company_id: companyId,
    company_name: "Example",
    job_evaluation_id: null,
    job_evaluated_at: null,
    company_evaluation_id: null,
    company_evaluated_at: null,
  };
}

for (const count of [1, 20, 100]) {
  test(`${count}件の一覧を1回のDB呼び出しで取得する`, async () => {
    let calls = 0;
    const rows = Array.from({ length: count + 1 }, (_, index) => row(index));
    const read: ReadSavedJobsPage = async (args) => {
      calls += 1;
      assert.equal(args.p_user_id, userId);
      assert.equal(args.p_limit, count);
      return rows;
    };
    const page = await createSavedJobsRepository(read).listPage(userId, count);
    assert.equal(calls, 1);
    assert.equal(page.items.length, count);
    assert.equal(
      page.nextCursor?.jobPostingId,
      rows[count - 1]?.job_posting_id,
    );
    assert.equal(page.items[0]?.companyName, "Example");
  });
}

test("最終ページはcursorを返さず、次ページには直前の末尾を渡す", async () => {
  const first = row(1);
  const second = row(2);
  const requests: Parameters<ReadSavedJobsPage>[0][] = [];
  const repository = createSavedJobsRepository(async (args) => {
    requests.push(args);
    return requests.length === 1 ? [first, second] : [second];
  });
  const page1 = await repository.listPage(userId, 1);
  const page2 = await repository.listPage(userId, 1, page1.nextCursor);
  assert.equal(page1.nextCursor?.jobPostingId, first.job_posting_id);
  assert.equal(requests[1]?.p_cursor_job_posting_id, first.job_posting_id);
  assert.equal(page2.items.length, 1);
  assert.equal(page2.nextCursor, null);
});

test("不正なuserId、limit、cursorをDBへ送らない", async () => {
  let calls = 0;
  const repository = createSavedJobsRepository(async () => {
    calls += 1;
    return [];
  });
  await assert.rejects(repository.listPage("invalid", 1), RangeError);
  await assert.rejects(repository.listPage(userId, 0), RangeError);
  await assert.rejects(repository.listPage(userId, 101), RangeError);
  await assert.rejects(
    repository.listPage(userId, 1, {
      savedAt: "invalid",
      jobPostingId: randomUUID(),
    }),
    RangeError,
  );
  assert.equal(calls, 0);
});

test("DB失敗と不正なDB応答の詳細を外へ出さない", async () => {
  const failing = createSavedJobsRepository(async () => {
    throw new Error("database internal detail");
  });
  await assert.rejects(failing.listPage(userId, 1), SavedJobsReadError);
  const malformed = createSavedJobsRepository(async () => [
    { unexpected: true },
  ]);
  await assert.rejects(malformed.listPage(userId, 1), SavedJobsReadError);
});
