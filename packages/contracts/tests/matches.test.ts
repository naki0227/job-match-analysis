import { describe, expect, it } from "vitest";
import { careerAxisKeys } from "../src/career-profile.js";
import {
  createMatchRequestSchema,
  matchReportSchema,
  type MatchReport,
} from "../src/matches.js";

const id = "44444444-4444-4444-8444-444444444444";
const at = "2026-09-29T00:00:00Z";

const report: MatchReport = {
  matchResultId: id,
  createdAt: at,
  profileVersion: 2,
  algorithmVersion: "match-engine-v1",
  companyName: "サンプルテック株式会社",
  jobTitle: "Backend Engineer",
  job: {
    status: "comparable",
    evaluationId: id,
    evaluatedAt: at,
    axes: careerAxisKeys.map((axisKey) => ({
      axisKey,
      status: "unknown",
      preference: 50,
      importance: 50,
      observed: null,
      evidence: [],
    })),
  },
  company: { status: "incompatible", evaluationId: id, evaluatedAt: at },
  hardConstraints: [
    { kind: "min_salary", status: "not_required" },
    { kind: "location", status: "unknown", reason: "missing_information" },
    { kind: "full_remote", status: "met" },
  ],
};

describe("match API contracts", () => {
  it("accepts only an evaluation ID, never client identity or profile", () => {
    expect(
      createMatchRequestSchema.safeParse({ evaluationId: id }).success,
    ).toBe(true);
    for (const input of [
      {},
      { evaluationId: "x" },
      { evaluationId: id, userId: id },
      { evaluationId: id, profile: {} },
    ]) {
      expect(createMatchRequestSchema.safeParse(input).success).toBe(false);
    }
  });

  it("accepts a report with evidence, unknown axes and no company", () => {
    expect(matchReportSchema.safeParse(report).success).toBe(true);
    expect(
      matchReportSchema.safeParse({ ...report, company: null }).success,
    ).toBe(true);
    const withEvidence = structuredClone(report);
    if (withEvidence.job.status !== "comparable") throw new Error("fixture");
    withEvidence.job.axes[0] = {
      axisKey: "work_location",
      status: "close",
      preference: 60,
      importance: 80,
      observed: 50,
      evidence: [
        {
          quote: "週2日在宅",
          sourceUrl: "https://jobs.example/1",
          fetchedAt: at,
        },
      ],
    };
    expect(matchReportSchema.safeParse(withEvidence).success).toBe(true);
  });

  it("rejects overall scores, non-anchor values and missing axes", () => {
    expect(matchReportSchema.safeParse({ ...report, score: 80 }).success).toBe(
      false,
    );
    const nonAnchor = structuredClone(report);
    if (nonAnchor.job.status !== "comparable") throw new Error("fixture");
    Object.assign(nonAnchor.job.axes[0]!, { observed: 70 });
    expect(matchReportSchema.safeParse(nonAnchor).success).toBe(false);
    const missing = structuredClone(report);
    if (missing.job.status !== "comparable") throw new Error("fixture");
    missing.job.axes.pop();
    expect(matchReportSchema.safeParse(missing).success).toBe(false);
  });
});
