import { expect, test } from "vitest";
import {
  analysisHistoryPageSchema,
  analysisHistoryQuerySchema,
} from "../src/analysis-history.js";

test("history query defaults to the first recent page", () => {
  expect(analysisHistoryQuerySchema.parse({})).toEqual({
    limit: 20,
    judgement: "all",
    sort: "recent",
  });
  expect(
    analysisHistoryQuerySchema.parse({
      limit: "100",
      role: " Backend Engineer ",
      judgement: "has_unknown",
      sort: "fewest_unknown",
    }),
  ).toMatchObject({ limit: 100, role: "Backend Engineer" });
});

test("invalid pagination and filter values are rejected before DB access", () => {
  for (const query of [
    { limit: "0" },
    { limit: "101" },
    { limit: "abc" },
    { cursor: "" },
    { role: " " },
    { judgement: "excellent" },
    { sort: "score" },
  ]) {
    expect(analysisHistoryQuerySchema.safeParse(query).success).toBe(false);
  }
});

test("history pages cannot carry missing version pairs or negative counts", () => {
  const item = {
    jobPostingId: "00000000-0000-4000-8000-000000000001",
    matchResultId: "00000000-0000-4000-8000-000000000002",
    analyzedAt: "2026-09-29T12:00:00Z",
    careerProfileVersionId: "00000000-0000-4000-8000-000000000003",
    profileVersion: 2,
    targetRoles: ["Backend Engineer"],
    jobTitle: "Backend Engineer",
    companyId: "00000000-0000-4000-8000-000000000004",
    companyName: "サンプル企業",
    jobEvaluationId: "00000000-0000-4000-8000-000000000005",
    jobEvaluatedAt: "2026-09-29T12:00:00Z",
    companyEvaluationId: null,
    companyEvaluatedAt: null,
    summary: { close: 3, different: 1, partial: 0, unknown: 4 },
    staleConditions: false,
  };
  expect(
    analysisHistoryPageSchema.safeParse({ items: [item], nextCursor: null })
      .success,
  ).toBe(true);
  expect(
    analysisHistoryPageSchema.safeParse({
      items: [{ ...item, jobEvaluationId: undefined }],
      nextCursor: null,
    }).success,
  ).toBe(false);
  expect(
    analysisHistoryPageSchema.safeParse({
      items: [{ ...item, summary: { ...item.summary, unknown: -1 } }],
      nextCursor: null,
    }).success,
  ).toBe(false);
});
