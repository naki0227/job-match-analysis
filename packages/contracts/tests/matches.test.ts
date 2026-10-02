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
  jobOverview: {
    salary: {
      status: "known",
      minimum: 6_000_000,
      maximum: 16_000_000,
      currency: "JPY",
      period: "year",
    },
    locations: { status: "known", values: ["東京都", "大阪府"] },
    employmentTypes: { status: "known", values: ["FULL_TIME"] },
    fullRemote: { status: "known", value: false },
    weeklyOfficeDays: { status: "known", value: 2 },
    scheduleFlexibility: { status: "unknown" },
    techStack: { status: "known", values: ["Go", "PostgreSQL"] },
  },
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

  it("accepts posting sections and fact evidence, and reports without them", () => {
    const withSections = {
      ...report,
      jobOverview: {
        ...report.jobOverview,
        salary: {
          status: "known",
          minimum: 6_000_000,
          maximum: 16_000_000,
          currency: "JPY",
          period: "year",
          evidence: "給与 年収 600万円 〜 1600万円",
        },
        duties: {
          status: "known",
          quotes: [{ section: "業務内容", text: "テックリード業務" }],
        },
        requirements: { status: "unknown" },
        workStyle: {
          status: "known",
          quotes: [{ section: null, text: "原則、週2出社必須" }],
        },
      },
    };
    expect(matchReportSchema.safeParse(withSections).success).toBe(true);
    // Older reports have no sections at all.
    expect(matchReportSchema.safeParse(report).success).toBe(true);
    for (const duties of [
      { status: "known", quotes: [] },
      { status: "conflicting" },
      { status: "known", quotes: [{ section: "", text: "x" }] },
    ]) {
      expect(
        matchReportSchema.safeParse({
          ...report,
          jobOverview: { ...report.jobOverview, duties },
        }).success,
      ).toBe(false);
    }
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
