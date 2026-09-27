import { describe, expect, it } from "vitest";
import {
  evaluateHardConstraints,
  type JobConditions,
} from "../src/hard-constraints.js";
import type { CareerConstraints } from "../src/career-profile.js";

const constraints: CareerConstraints = {
  minSalary: { amount: 5_000_000, currency: "JPY", period: "year" },
  allowedPrefectureCodes: ["13", "27"],
  fullRemoteRequired: true,
};

function salaryStatus(salary: JobConditions["salary"]) {
  return evaluateHardConstraints(constraints, { salary })[0];
}

describe("minimum salary", () => {
  it("meets the requirement when the whole annual JPY range is high enough", () => {
    expect(
      salaryStatus({
        status: "known",
        value: {
          minimum: 5_000_000,
          maximum: 7_000_000,
          currency: "JPY",
          period: "year",
        },
      }),
    ).toMatchObject({ status: "met" });
  });

  it("reports a hard conflict when the whole range is below the minimum", () => {
    expect(
      salaryStatus({
        status: "known",
        value: {
          minimum: 3_500_000,
          maximum: 4_500_000,
          currency: "JPY",
          period: "year",
        },
      }),
    ).toEqual({
      kind: "min_salary",
      status: "unmet",
      reason: "salary_below_minimum",
    });
  });

  it("does not guess when the range crosses the minimum", () => {
    expect(
      salaryStatus({
        status: "known",
        value: {
          minimum: 4_500_000,
          maximum: 6_000_000,
          currency: "JPY",
          period: "year",
        },
      }),
    ).toEqual({
      kind: "min_salary",
      status: "unknown",
      reason: "salary_range_overlaps_minimum",
    });
  });

  it.each([
    { currency: "USD", period: "year" },
    { currency: "JPY", period: "month" },
  ])("does not convert $currency/$period", ({ currency, period }) => {
    expect(
      salaryStatus({
        status: "known",
        value: { minimum: 6_000_000, maximum: 7_000_000, currency, period },
      }),
    ).toEqual({
      kind: "min_salary",
      status: "unknown",
      reason: "salary_unit_mismatch",
    });
  });

  it.each([
    [undefined, "missing_information"],
    [{ status: "unknown" }, "missing_information"],
    [{ status: "conflicting" }, "conflicting_information"],
    [
      {
        status: "stale",
        value: {
          minimum: 6_000_000,
          maximum: 7_000_000,
          currency: "JPY",
          period: "year",
        },
      },
      "stale_information",
    ],
  ] as const)(
    "keeps missing, conflicting and stale salary as unknown",
    (salary, reason) => {
      expect(salaryStatus(salary)).toEqual({
        kind: "min_salary",
        status: "unknown",
        reason,
      });
    },
  );

  it("rejects a reversed salary range", () => {
    expect(() =>
      salaryStatus({
        status: "known",
        value: {
          minimum: 7_000_000,
          maximum: 6_000_000,
          currency: "JPY",
          period: "year",
        },
      }),
    ).toThrow(RangeError);
  });
});

describe("location and full remote", () => {
  it("accepts an explicitly selectable allowed prefecture and full remote job", () => {
    const results = evaluateHardConstraints(constraints, {
      availablePrefectureCodes: { status: "known", value: ["13", "14"] },
      fullRemote: { status: "known", value: true },
    });
    expect(results[1]).toMatchObject({ status: "met" });
    expect(results[2]).toMatchObject({ status: "met" });
  });

  it("keeps conflicts separate from soft axis matches", () => {
    const results = evaluateHardConstraints(constraints, {
      availablePrefectureCodes: { status: "known", value: ["14"] },
      fullRemote: { status: "known", value: false },
    });
    expect(results[1]).toEqual({
      kind: "location",
      status: "unmet",
      reason: "location_outside_allowed",
    });
    expect(results[2]).toEqual({
      kind: "full_remote",
      status: "unmet",
      reason: "regular_office_attendance_required",
    });
  });

  it("does not treat unknown or stale job conditions as mismatches", () => {
    const results = evaluateHardConstraints(constraints, {
      availablePrefectureCodes: { status: "unknown" },
      fullRemote: { status: "stale", value: true },
    });
    expect(results[1]).toMatchObject({ status: "unknown" });
    expect(results[2]).toMatchObject({ status: "unknown" });
  });

  it("rejects invalid known prefectures", () => {
    expect(() =>
      evaluateHardConstraints(constraints, {
        availablePrefectureCodes: { status: "known", value: ["48"] },
      }),
    ).toThrow(RangeError);
  });

  it("marks absent requirements as not required", () => {
    const results = evaluateHardConstraints({ fullRemoteRequired: false }, {});
    expect(results.map((entry) => entry.status)).toEqual([
      "not_required",
      "not_required",
      "not_required",
    ]);
  });
});
