import { describe, expect, it } from "vitest";
import { careerAxisKeys } from "../src/career-profile.js";
import type { MatchReport } from "../src/matches.js";
import {
  matchShareSchema,
  sharedMatchSchema,
  shareTokenSchema,
  summarizeSharedMatch,
  toSharedMatch,
} from "../src/shares.js";

const id = "44444444-4444-4444-8444-444444444444";
const at = "2026-09-29T00:00:00Z";

const report: MatchReport = {
  matchResultId: id,
  createdAt: at,
  profileVersion: 3,
  algorithmVersion: "match-engine-v1",
  companyName: "サンプルテック株式会社",
  jobTitle: "Backend Engineer",
  job: {
    status: "comparable",
    evaluationId: id,
    evaluatedAt: at,
    axes: [...careerAxisKeys].reverse().map((axisKey, index) => ({
      axisKey,
      status: index === 0 ? "stale" : index === 1 ? "conflicting" : "close",
      preference: 87,
      importance: 64,
      observed: index < 2 ? null : 100,
      evidence: [
        {
          quote: "年収600万円以上",
          sourceUrl: "https://jobs.example/1",
          fetchedAt: at,
        },
      ],
    })),
  },
  company: null,
  hardConstraints: [
    { kind: "min_salary", status: "unmet", reason: "salary_below_minimum" },
    { kind: "location", status: "met" },
    { kind: "full_remote", status: "not_required" },
  ],
};

describe("share contracts", () => {
  it("projects only names, evaluation time and per-axis judgements", () => {
    const projection = toSharedMatch(report);
    expect(Object.keys(projection).sort()).toEqual([
      "axes",
      "companyName",
      "evaluatedAt",
      "jobTitle",
    ]);
    expect(projection.axes.map((axis) => axis.axisKey)).toEqual([
      ...careerAxisKeys,
    ]);
    expect(projection.axes.at(-1)).toEqual({
      axisKey: "customer_contact",
      status: "stale",
    });
    const serialized = JSON.stringify(projection);
    for (const secret of ["87", "64", "600万円", "salary", "profileVersion"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(sharedMatchSchema.parse(projection)).toEqual(projection);
  });

  it("rejects extra fields such as scores or preferences", () => {
    const projection = toSharedMatch(report);
    expect(
      sharedMatchSchema.safeParse({ ...projection, score: 80 }).success,
    ).toBe(false);
    expect(
      sharedMatchSchema.safeParse({
        ...projection,
        axes: projection.axes.map((axis) => ({ ...axis, preference: 87 })),
      }).success,
    ).toBe(false);
  });

  it("refuses incompatible results and short tokens", () => {
    expect(() =>
      toSharedMatch({
        ...report,
        job: { status: "incompatible", evaluationId: id, evaluatedAt: at },
      }),
    ).toThrow(RangeError);
    expect(shareTokenSchema.safeParse("a".repeat(43)).success).toBe(true);
    expect(shareTokenSchema.safeParse("a".repeat(42)).success).toBe(false);
    expect(shareTokenSchema.safeParse("a".repeat(42) + "/").success).toBe(
      false,
    );
    expect(
      matchShareSchema.safeParse({
        shareId: id,
        token: "b".repeat(43),
        sharedAt: at,
        projection: toSharedMatch(report),
      }).success,
    ).toBe(true);
  });

  it("summarizes counts without turning unknown states into numbers", () => {
    const summary = summarizeSharedMatch(toSharedMatch(report));
    expect(summary).toEqual({
      close: 6,
      different: 0,
      unknown: 2,
      closeAxes: ["work_location", "autonomy", "collaboration"],
    });
  });
});
