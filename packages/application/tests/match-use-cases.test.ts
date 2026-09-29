import {
  careerAxisKeys,
  type CareerProfileResponse,
} from "@job-match/contracts";
import type { AxisComparison, AxisEvidence } from "@job-match/domain";
import { describe, expect, it, vi } from "vitest";
import {
  MATCH_ALGORITHM_VERSION,
  createMatch,
  readMatch,
  type EvaluationSnapshot,
  type MatchEvaluationSource,
  type MatchPorts,
  type StoredMatch,
} from "../src/index.js";

const userId = "11111111-1111-4111-8111-111111111111";
const profileVersionId = "22222222-2222-4222-8222-222222222222";
const jobEvaluationId = "33333333-3333-4333-8333-333333333333";
const companyEvaluationId = "44444444-4444-4444-8444-444444444444";
const matchResultId = "55555555-5555-4555-8555-555555555555";
const at = "2026-09-29T00:00:00Z";
const jobUrl = "https://jobs.example/sample/1";

const profile: CareerProfileResponse = {
  profileVersionId,
  profileVersion: 3,
  profile: {
    axisCatalogVersion: 1,
    targetRoles: ["Backend Engineer"],
    axisValues: careerAxisKeys.map((axisKey) => ({
      axisKey,
      axisVersion: 1,
      preference: axisKey === "work_location" ? 90 : 50,
      importance: axisKey === "work_change" ? 0 : 60,
    })),
    constraints: {
      minSalary: { amount: 5_000_000, currency: "JPY", period: "year" },
      allowedPrefectureCodes: [],
      fullRemoteRequired: false,
    },
  },
};

function snapshot(
  evaluationId: string,
  axisValues: AxisEvidence[],
  axisCatalogVersion = 1,
): EvaluationSnapshot {
  return {
    evaluationId,
    evaluatedAt: at,
    axisCatalogVersion,
    axisValues,
    evidence: [
      {
        axisKey: "work_location",
        quote: "週3日オフィス勤務",
        sourceUrl: jobUrl,
        fetchedAt: at,
      },
    ],
  };
}

const jobSource: MatchEvaluationSource = {
  targetType: "job",
  companyName: "サンプルテック株式会社",
  jobTitle: "Backend Engineer",
  evaluation: snapshot(jobEvaluationId, [
    {
      axisKey: "work_location",
      axisVersion: 1,
      observation: { status: "known", value: 50 },
    },
    {
      axisKey: "autonomy",
      axisVersion: 1,
      observation: { status: "known", value: 50 },
    },
  ]),
  companyEvaluation: snapshot(companyEvaluationId, [
    {
      axisKey: "schedule_flexibility",
      axisVersion: 1,
      observation: { status: "known", value: 100 },
    },
  ]),
};

function ports(overrides: Partial<MatchPorts> = {}): MatchPorts {
  return {
    latestProfile: vi.fn(async () => profile),
    readEvaluation: vi.fn(async () => jobSource),
    commitMatch: vi.fn(async () => ({
      matchResultId,
      createdAt: at,
      created: true,
    })),
    readMatch: vi.fn(async () => null),
    ...overrides,
  };
}

describe("createMatch", () => {
  it("stores the job comparison and returns a report with evidence", async () => {
    const deps = ports();
    const result = await createMatch(deps, {
      userId,
      evaluationId: jobEvaluationId,
    });
    if (result.status !== "created") throw new Error(result.status);
    const { report } = result;
    expect(report).toMatchObject({
      matchResultId,
      profileVersion: 3,
      algorithmVersion: MATCH_ALGORITHM_VERSION,
      companyName: "サンプルテック株式会社",
      jobTitle: "Backend Engineer",
    });
    if (report.job.status !== "comparable") throw new Error("job");
    const byKey = new Map(report.job.axes.map((axis) => [axis.axisKey, axis]));
    expect(byKey.get("work_location")).toEqual({
      axisKey: "work_location",
      status: "different",
      preference: 90,
      importance: 60,
      observed: 50,
      evidence: [
        { quote: "週3日オフィス勤務", sourceUrl: jobUrl, fetchedAt: at },
      ],
    });
    expect(byKey.get("autonomy")).toMatchObject({
      status: "close",
      evidence: [],
    });
    expect(byKey.get("work_change")?.status).toBe("excluded");
    expect(byKey.get("customer_contact")).toMatchObject({
      status: "unknown",
      observed: null,
    });
    expect(report.company).toMatchObject({
      status: "comparable",
      evaluationId: companyEvaluationId,
    });
    expect(report.hardConstraints).toEqual([
      { kind: "min_salary", status: "unknown", reason: "missing_information" },
      { kind: "location", status: "not_required" },
      { kind: "full_remote", status: "not_required" },
    ]);
    expect(deps.commitMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        profileVersionId,
        evaluationId: jobEvaluationId,
        algorithmVersion: MATCH_ALGORITHM_VERSION,
      }),
    );
    const committed = vi.mocked(deps.commitMatch).mock.calls[0]![0];
    expect(committed.axes).toHaveLength(8);
    expect(committed.axes.every((axis) => axis.source === "job")).toBe(true);
  });

  it("reports an existing match when the same inputs were stored", async () => {
    const result = await createMatch(
      ports({
        commitMatch: async () => ({
          matchResultId,
          createdAt: at,
          created: false,
        }),
      }),
      { userId, evaluationId: jobEvaluationId },
    );
    expect(result.status).toBe("existing");
  });

  it("does not store when inputs are missing or not comparable", async () => {
    const cases: Array<[Partial<MatchPorts>, string]> = [
      [{ readEvaluation: async () => null }, "evaluation_not_found"],
      [
        {
          readEvaluation: async () => ({
            ...jobSource,
            targetType: "company",
            jobTitle: null,
          }),
        },
        "not_job_evaluation",
      ],
      [{ latestProfile: async () => null }, "profile_missing"],
      [
        {
          readEvaluation: async () => ({
            ...jobSource,
            evaluation: { ...jobSource.evaluation, axisCatalogVersion: 2 },
          }),
        },
        "incompatible",
      ],
    ];
    for (const [overrides, status] of cases) {
      const deps = ports(overrides);
      const result = await createMatch(deps, {
        userId,
        evaluationId: jobEvaluationId,
      });
      expect(result.status).toBe(status);
      expect(deps.commitMatch).not.toHaveBeenCalled();
    }
  });

  it("keeps the job result when only the company version differs", async () => {
    const result = await createMatch(
      ports({
        readEvaluation: async () => ({
          ...jobSource,
          companyEvaluation: snapshot(companyEvaluationId, [], 2),
        }),
      }),
      { userId, evaluationId: jobEvaluationId },
    );
    if (result.status !== "created") throw new Error(result.status);
    expect(result.report.job.status).toBe("comparable");
    expect(result.report.company?.status).toBe("incompatible");
  });

  it("returns no company section without a company evaluation", async () => {
    const result = await createMatch(
      ports({
        readEvaluation: async () => ({ ...jobSource, companyEvaluation: null }),
      }),
      { userId, evaluationId: jobEvaluationId },
    );
    if (result.status !== "created") throw new Error(result.status);
    expect(result.report.company).toBeNull();
  });

  it("propagates storage failures", async () => {
    await expect(
      createMatch(
        ports({
          commitMatch: async () => {
            throw new Error("unavailable");
          },
        }),
        { userId, evaluationId: jobEvaluationId },
      ),
    ).rejects.toThrow("unavailable");
  });
});

describe("readMatch", () => {
  const storedAxes: AxisComparison[] = careerAxisKeys.map((axisKey) => ({
    axisKey,
    source: "job",
    preference: 20,
    importance: 40,
    observation: { status: "known", value: 0 },
    status: "close",
    difference: 20,
  }));
  const stored: StoredMatch = {
    matchResultId,
    createdAt: at,
    algorithmVersion: MATCH_ALGORITHM_VERSION,
    evaluationId: jobEvaluationId,
    profileVersion: 2,
    axisCatalogVersion: 1,
    axes: storedAxes,
    constraints: [
      { kind: "min_salary", status: "not_required" },
      { kind: "location", status: "not_required" },
      { kind: "full_remote", status: "not_required" },
    ],
  };

  it("returns not_found for another user's or a missing match", async () => {
    const deps = ports();
    expect(await readMatch(deps, { userId, matchResultId })).toEqual({
      status: "not_found",
    });
    expect(deps.readMatch).toHaveBeenCalledWith(userId, matchResultId);
    expect(deps.readEvaluation).not.toHaveBeenCalled();
  });

  it("uses the stored snapshot for the job and recomputes the company", async () => {
    const deps = ports({ readMatch: async () => stored });
    const result = await readMatch(deps, { userId, matchResultId });
    if (result.status !== "found") throw new Error(result.status);
    const { report } = result;
    expect(report.profileVersion).toBe(2);
    if (report.job.status !== "comparable") throw new Error("job");
    expect(report.job.axes[0]).toMatchObject({
      axisKey: "work_location",
      preference: 20,
      observed: 0,
      status: "close",
      evidence: [{ quote: "週3日オフィス勤務" }],
    });
    if (report.company?.status !== "comparable") throw new Error("company");
    const flexibility = report.company.axes.find(
      (axis) => axis.axisKey === "schedule_flexibility",
    );
    expect(flexibility).toMatchObject({
      preference: 20,
      observed: 100,
      status: "different",
    });
    expect(deps.latestProfile).not.toHaveBeenCalled();
  });

  it("fails loudly when the stored evaluation disappeared", async () => {
    await expect(
      readMatch(
        ports({
          readMatch: async () => stored,
          readEvaluation: async () => null,
        }),
        { userId, matchResultId },
      ),
    ).rejects.toThrow();
  });
});
