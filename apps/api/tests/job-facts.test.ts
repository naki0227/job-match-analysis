import assert from "node:assert/strict";
import test from "node:test";
import { jobOverviewSchema } from "@job-match/contracts";
import { toJobFacts } from "../src/repositories/job-facts.js";
import { MatchStoreError } from "../src/repositories/match-store-error.js";

test("求人概要は保存された原文の根拠と、見出しごとの引用を返す", () => {
  const { overview, conditions } = toJobFacts([
    {
      kind: "salary",
      payload: {
        status: "known",
        value: {
          minimum: 6_000_000,
          maximum: 16_000_000,
          currency: "JPY",
          period: "year",
        },
        excerpt: "給与 年収 600万円 〜 1600万円",
        locator: "tr:line-99",
      },
    },
    {
      kind: "weeklyOfficeDays",
      payload: {
        status: "known",
        value: 2,
        excerpt: "原則、週2出社必須",
        locator: "tr:line-103",
        method: "jev",
      },
    },
    {
      kind: "duties",
      payload: {
        status: "known",
        value: [
          { section: "業務内容", text: "各プロダクトのテックリード業務" },
          { section: null, text: "設計から運用まで担当します" },
        ],
        excerpt: "各プロダクトのテックリード業務",
        locator: "li:line-3:fragment-4:part-1",
      },
    },
    { kind: "requirements", payload: { status: "unknown" } },
  ]);
  assert.deepEqual(overview.salary, {
    status: "known",
    minimum: 6_000_000,
    maximum: 16_000_000,
    currency: "JPY",
    period: "year",
    evidence: "給与 年収 600万円 〜 1600万円",
  });
  assert.deepEqual(overview.weeklyOfficeDays, {
    status: "known",
    value: 2,
    evidence: "原則、週2出社必須",
  });
  assert.deepEqual(overview.duties, {
    status: "known",
    quotes: [
      { section: "業務内容", text: "各プロダクトのテックリード業務" },
      { section: null, text: "設計から運用まで担当します" },
    ],
  });
  assert.deepEqual(overview.requirements, { status: "unknown" });
  assert.deepEqual(overview.workStyle, { status: "unknown" });
  // Evidence is for display; the match engine still gets only the value.
  assert.deepEqual(conditions.salary, {
    status: "known",
    value: {
      minimum: 6_000_000,
      maximum: 16_000_000,
      currency: "JPY",
      period: "year",
    },
  });
  assert.equal(jobOverviewSchema.safeParse(overview).success, true);
});

test("壊れたsection行は内部詳細を出さない保存エラーにする", () => {
  for (const payload of [
    { status: "known", value: [] },
    { status: "known", value: [{ section: "業務内容" }] },
    { status: "known", value: "業務内容" },
  ]) {
    assert.throws(
      () => toJobFacts([{ kind: "duties", payload }]),
      MatchStoreError,
    );
  }
  assert.throws(
    () => toJobFacts([{ kind: "benefits", payload: { status: "unknown" } }]),
    MatchStoreError,
  );
});
