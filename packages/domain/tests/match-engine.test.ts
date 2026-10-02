import { describe, expect, it } from "vitest";
import {
  AXIS_CATALOG_VERSION,
  AXIS_KEYS,
  compareTarget,
  createCareerProfileVersion,
  matchCareerProfile,
  type AxisEvidence,
  type JobEvaluation,
  type TargetEvaluation,
} from "../src/index.js";

function profile(preference = 75, importance = 100) {
  return createCareerProfileVersion({
    profileVersion: 1,
    axisCatalogVersion: AXIS_CATALOG_VERSION,
    targetRoles: ["ソフトウェアエンジニア"],
    axisValues: AXIS_KEYS.map((axisKey) => ({
      axisKey,
      axisVersion: AXIS_CATALOG_VERSION,
      preference,
      importance,
    })),
    constraints: {
      minSalary: { amount: 5_000_000, currency: "JPY", period: "year" },
      fullRemoteRequired: false,
    },
  });
}

function evidence(
  observation: AxisEvidence["observation"],
  axisKey = AXIS_KEYS[0],
): AxisEvidence {
  return { axisKey, axisVersion: AXIS_CATALOG_VERSION, observation };
}

function job(axisValues: readonly AxisEvidence[] = []): JobEvaluation {
  return { axisCatalogVersion: AXIS_CATALOG_VERSION, axisValues };
}

function axisStatus(value: ReturnType<typeof compareTarget>, index = 0) {
  if (value.status !== "comparable") {
    throw new Error("Expected comparable result");
  }
  return value.axes[index];
}

describe("axis comparison", () => {
  it("uses the documented 25 point boundary", () => {
    const close = compareTarget(
      profile(75),
      job([evidence({ status: "known", value: 50 })]),
      "job",
    );
    const different = compareTarget(
      profile(76),
      job([evidence({ status: "known", value: 50 })]),
      "job",
    );
    expect(axisStatus(close)).toMatchObject({
      status: "close",
      difference: 25,
    });
    expect(axisStatus(different)).toMatchObject({
      status: "different",
      difference: 26,
    });
  });

  it("compares a range by both ends: close, partial or different", () => {
    const range = evidence({ status: "range", minimum: 50, maximum: 100 });
    const at = (preference: number) =>
      axisStatus(compareTarget(profile(preference), job([range]), "job"));
    // Both documented anchors are within 25.
    expect(at(75)).toMatchObject({
      status: "close",
      difference: 25,
      differenceMax: 25,
    });
    // One documented anchor is close and the other is far: neither confirmed nor ruled out.
    expect(at(100)).toMatchObject({
      status: "partial",
      difference: 0,
      differenceMax: 50,
    });
    expect(at(30)).toMatchObject({
      status: "partial",
      difference: 20,
      differenceMax: 70,
    });
    // Even the nearest end is more than 25 away.
    expect(at(24)).toMatchObject({
      status: "different",
      difference: 26,
      differenceMax: 76,
    });
    expect(at(25)).toMatchObject({ status: "partial", difference: 25 });
  });

  it("accepts only a range of two adjacent anchors", () => {
    for (const observation of [
      { status: "range", minimum: 0, maximum: 100 },
      { status: "range", minimum: 50, maximum: 50 },
      { status: "range", minimum: 100, maximum: 50 },
      { status: "range", minimum: 25, maximum: 75 },
    ]) {
      expect(() =>
        compareTarget(
          profile(),
          job([evidence(observation as AxisEvidence["observation"])]),
          "job",
        ),
      ).toThrow(RangeError);
    }
    expect(
      axisStatus(
        compareTarget(
          profile(0),
          job([evidence({ status: "range", minimum: 0, maximum: 50 })]),
          "job",
        ),
      ),
    ).toMatchObject({ status: "partial", difference: 0, differenceMax: 50 });
  });

  it("excludes importance zero while retaining preference", () => {
    const result = compareTarget(
      profile(75, 0),
      job([evidence({ status: "known", value: 0 })]),
      "job",
    );
    expect(axisStatus(result)).toMatchObject({
      status: "excluded",
      preference: 75,
      importance: 0,
    });
    expect(axisStatus(result)).not.toHaveProperty("difference");
  });

  it.each([
    [{ status: "unknown" }, "unknown"],
    [{ status: "conflicting" }, "conflicting"],
    [{ status: "stale", value: 50 }, "stale"],
  ] as const)("does not compare %s evidence", (observation, status) => {
    const result = compareTarget(
      profile(),
      job([evidence(observation)]),
      "job",
    );
    expect(axisStatus(result)).toMatchObject({ status });
    expect(axisStatus(result)).not.toHaveProperty("difference");
  });

  it("keeps a missing axis unknown", () => {
    const result = compareTarget(profile(), job(), "job");
    expect(axisStatus(result)).toMatchObject({ status: "unknown" });
  });

  it("rejects an undocumented numeric anchor and duplicate evidence", () => {
    expect(() =>
      compareTarget(
        profile(),
        job([evidence({ status: "known", value: 72 })]),
        "job",
      ),
    ).toThrow(RangeError);
    const duplicate = evidence({ status: "known", value: 50 });
    expect(() =>
      compareTarget(profile(), job([duplicate, duplicate]), "job"),
    ).toThrow(RangeError);
  });

  it("reports a catalog or axis version mismatch", () => {
    const wrongCatalog: TargetEvaluation = {
      axisCatalogVersion: 2,
      axisValues: [],
    };
    const wrongAxis = job([
      { ...evidence({ status: "known", value: 50 }), axisVersion: 2 },
    ]);
    expect(compareTarget(profile(), wrongCatalog, "job")).toMatchObject({
      status: "incompatible",
    });
    expect(compareTarget(profile(), wrongAxis, "job")).toMatchObject({
      status: "incompatible",
    });
  });
});

describe("MatchEngine", () => {
  it("keeps job and company results separate without filling missing job values", () => {
    const result = matchCareerProfile({
      profile: profile(),
      job: job(),
      company: job([evidence({ status: "known", value: 50 })]),
    });
    expect(axisStatus(result.job)).toMatchObject({
      status: "unknown",
      source: "job",
    });
    expect(result.company).toBeDefined();
    if (result.company === undefined)
      throw new Error("Expected company comparison");
    expect(axisStatus(result.company)).toMatchObject({
      status: "close",
      source: "company",
    });
    expect(result).not.toHaveProperty("overallPercentage");
  });

  it("keeps a company version mismatch independent from the job", () => {
    const result = matchCareerProfile({
      profile: profile(),
      job: job([evidence({ status: "known", value: 50 })]),
      company: { axisCatalogVersion: 2, axisValues: [] },
    });
    expect(result.job.status).toBe("comparable");
    expect(result.company?.status).toBe("incompatible");
  });

  it("returns a hard salary conflict even when a soft axis is close", () => {
    const result = matchCareerProfile({
      profile: profile(),
      job: {
        ...job([evidence({ status: "known", value: 50 })]),
        salary: {
          status: "known",
          value: {
            minimum: 3_000_000,
            maximum: 4_000_000,
            currency: "JPY",
            period: "year",
          },
        },
      },
    });
    expect(axisStatus(result.job).status).toBe("close");
    expect(result.hasHardConflict).toBe(true);
    expect(result.hardConstraints[0]).toEqual({
      kind: "min_salary",
      status: "unmet",
      reason: "salary_below_minimum",
    });
  });

  it("does not convert a different salary unit", () => {
    const result = matchCareerProfile({
      profile: profile(),
      job: {
        ...job(),
        salary: {
          status: "known",
          value: {
            minimum: 100_000,
            maximum: 200_000,
            currency: "USD",
            period: "year",
          },
        },
      },
    });
    expect(result.hasHardConflict).toBe(false);
    expect(result.hardConstraints[0]).toMatchObject({
      status: "unknown",
      reason: "salary_unit_mismatch",
    });
  });
});
