import { describe, expect, test } from "vitest";
import {
  careerAxisKeys,
  careerProfilePayloadSchema,
  commitCareerProfileRequestSchema,
} from "../src/index.js";

const validProfile = {
  axisCatalogVersion: 1,
  targetRoles: ["エンジニア"],
  axisValues: careerAxisKeys.map((axisKey) => ({
    axisKey,
    axisVersion: 1,
    preference: 0,
    importance: 100,
  })),
  constraints: {
    allowedPrefectureCodes: ["13"],
    fullRemoteRequired: false,
  },
};

describe("career profile API contract", () => {
  test("accepts boundary percentages and optional salary", () => {
    const result = careerProfilePayloadSchema.parse({
      ...validProfile,
      constraints: {
        ...validProfile.constraints,
        minSalary: { amount: 5000000, currency: "JPY", period: "year" },
      },
    });
    expect(result.axisValues[0]?.preference).toBe(0);
    expect(result.axisValues[0]?.importance).toBe(100);
  });

  test("rejects missing, duplicated, and out-of-range axis answers", () => {
    expect(
      careerProfilePayloadSchema.safeParse({
        ...validProfile,
        axisValues: validProfile.axisValues.slice(1),
      }).success,
    ).toBe(false);
    expect(
      careerProfilePayloadSchema.safeParse({
        ...validProfile,
        axisValues: [
          ...validProfile.axisValues.slice(1),
          validProfile.axisValues[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      careerProfilePayloadSchema.safeParse({
        ...validProfile,
        axisValues: [
          { ...validProfile.axisValues[0], preference: 101 },
          ...validProfile.axisValues.slice(1),
        ],
      }).success,
    ).toBe(false);
  });

  test("rejects blank and duplicated roles, invalid locations, and bad versions", () => {
    for (const candidate of [
      { ...validProfile, targetRoles: [" "] },
      { ...validProfile, targetRoles: ["営業", " 営業 "] },
      {
        ...validProfile,
        constraints: {
          ...validProfile.constraints,
          allowedPrefectureCodes: ["99"],
        },
      },
      { ...validProfile, axisCatalogVersion: 2 },
    ]) {
      expect(careerProfilePayloadSchema.safeParse(candidate).success).toBe(
        false,
      );
    }
  });

  test("requires an optimistic version and idempotency key", () => {
    expect(
      commitCareerProfileRequestSchema.safeParse({
        expectedVersion: 0,
        idempotencyKey: "b7ea20b2-c553-4ad9-860b-f70d290bf614",
        profile: validProfile,
      }).success,
    ).toBe(true);
    expect(
      commitCareerProfileRequestSchema.safeParse({
        expectedVersion: -1,
        idempotencyKey: "invalid",
        profile: validProfile,
      }).success,
    ).toBe(false);
  });
});
