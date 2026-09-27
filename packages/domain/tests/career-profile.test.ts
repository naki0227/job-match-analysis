import { describe, expect, it } from "vitest";
import { AXIS_KEYS } from "../src/axis.js";
import {
  createCareerProfileVersion,
  reviseCareerProfileVersion,
} from "../src/career-profile.js";

function profileInput() {
  return {
    profileVersion: 1,
    axisCatalogVersion: 1,
    targetRoles: ["ソフトウェアエンジニア"],
    axisValues: AXIS_KEYS.map((axisKey) => ({
      axisKey,
      axisVersion: 1,
      preference: 50,
      importance: 50,
    })),
    constraints: {
      minSalary: { amount: 5_000_000, currency: "JPY", period: "year" },
      allowedPrefectureCodes: ["13", "27"],
      fullRemoteRequired: true,
    },
  };
}

describe("createCareerProfileVersion", () => {
  it("keeps preference and importance separate, including importance zero", () => {
    const input = profileInput();
    input.axisValues[0].preference = 100;
    input.axisValues[0].importance = 0;
    input.axisValues[1].preference = 0;
    input.axisValues[1].importance = 100;

    const profile = createCareerProfileVersion(input);

    expect(profile.status).toBe("completed");
    expect(profile.axisValues).toHaveLength(8);
    expect(profile.targetRoles).toEqual(["ソフトウェアエンジニア"]);
    expect(profile.axisValues[0]).toMatchObject({
      preference: 100,
      importance: 0,
    });
    expect(profile.axisValues[1]).toMatchObject({
      preference: 0,
      importance: 100,
    });
    expect(profile.constraints.minSalary).toEqual({
      amount: 5_000_000,
      currency: "JPY",
      period: "year",
    });
    expect(profile.constraints.allowedPrefectureCodes).toEqual(["13", "27"]);
  });

  it("takes a deeply frozen snapshot rather than retaining mutable input", () => {
    const input = profileInput();
    const profile = createCareerProfileVersion(input);
    input.axisValues[0].preference = 0;
    input.targetRoles[0] = "デザイナー";
    input.constraints.allowedPrefectureCodes[0] = "01";

    expect(profile.axisValues[0].preference).toBe(50);
    expect(profile.targetRoles).toEqual(["ソフトウェアエンジニア"]);
    expect(profile.constraints.allowedPrefectureCodes).toEqual(["13", "27"]);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.axisValues)).toBe(true);
    expect(Object.isFrozen(profile.axisValues[0])).toBe(true);
    expect(Object.isFrozen(profile.targetRoles)).toBe(true);
    expect(Object.isFrozen(profile.constraints)).toBe(true);
    expect(Object.isFrozen(profile.constraints.minSalary)).toBe(true);
    expect(Object.isFrozen(profile.constraints.allowedPrefectureCodes)).toBe(
      true,
    );
  });

  it("allows a completed profile without optional hard constraints", () => {
    const input = profileInput();
    const profile = createCareerProfileVersion({
      ...input,
      constraints: { fullRemoteRequired: false },
    });
    expect(profile.constraints).toEqual({ fullRemoteRequired: false });
  });

  it("rejects missing, duplicate, or unknown axes", () => {
    const missing = profileInput();
    missing.axisValues.pop();
    expect(() => createCareerProfileVersion(missing)).toThrow(RangeError);

    const duplicate = profileInput();
    duplicate.axisValues[1].axisKey = duplicate.axisValues[0].axisKey;
    expect(() => createCareerProfileVersion(duplicate)).toThrow(RangeError);

    const unknown = profileInput();
    expect(() =>
      createCareerProfileVersion({
        ...unknown,
        axisValues: [
          { ...unknown.axisValues[0], axisKey: "salary" },
          ...unknown.axisValues.slice(1),
        ],
      }),
    ).toThrow(RangeError);
  });

  it("requires a nonempty list of distinct, nonblank target roles", () => {
    for (const targetRoles of [
      undefined,
      [],
      ["  "],
      ["エンジニア", " エンジニア "],
      [42],
    ]) {
      expect(() =>
        createCareerProfileVersion({ ...profileInput(), targetRoles }),
      ).toThrow();
    }
    expect(
      createCareerProfileVersion({
        ...profileInput(),
        targetRoles: ["  エンジニア  ", "デザイナー"],
      }).targetRoles,
    ).toEqual(["エンジニア", "デザイナー"]);
  });

  it("rejects mixed or unsupported catalog versions", () => {
    const mixed = profileInput();
    mixed.axisValues[0].axisVersion = 2;
    expect(() => createCareerProfileVersion(mixed)).toThrow(RangeError);

    const unsupported = profileInput();
    unsupported.axisCatalogVersion = 2;
    expect(() => createCareerProfileVersion(unsupported)).toThrow(RangeError);
  });

  it("rejects invalid percentage, profile version, or draft status", () => {
    const input = profileInput();
    input.axisValues[0].importance = 101;
    expect(() => createCareerProfileVersion(input)).toThrow(RangeError);
    expect(() =>
      createCareerProfileVersion({ ...profileInput(), profileVersion: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      createCareerProfileVersion({ ...profileInput(), status: "draft" }),
    ).toThrow(RangeError);
  });

  it("rejects invalid salary currency, period, and amount", () => {
    for (const minSalary of [
      { amount: 0, currency: "JPY", period: "year" },
      { amount: 5_000_000, currency: "USD", period: "year" },
      { amount: 5_000_000, currency: "JPY", period: "month" },
    ]) {
      const input = profileInput();
      expect(() =>
        createCareerProfileVersion({
          ...input,
          constraints: { ...input.constraints, minSalary },
        }),
      ).toThrow(RangeError);
    }
  });

  it("rejects empty, repeated, or invalid prefectures and a nonboolean remote flag", () => {
    for (const allowedPrefectureCodes of [[], ["13", "13"], ["48"]]) {
      const input = profileInput();
      expect(() =>
        createCareerProfileVersion({
          ...input,
          constraints: { ...input.constraints, allowedPrefectureCodes },
        }),
      ).toThrow(RangeError);
    }
    expect(() =>
      createCareerProfileVersion({
        ...profileInput(),
        constraints: { fullRemoteRequired: "true" },
      }),
    ).toThrow(TypeError);
  });
});

describe("reviseCareerProfileVersion", () => {
  it("creates the next immutable version without changing the completed one", () => {
    const previous = createCareerProfileVersion(profileInput());
    const revision = profileInput();
    revision.axisValues[0].preference = 100;
    revision.targetRoles = ["デザイナー", "リサーチャー"];
    revision.constraints.allowedPrefectureCodes = ["01"];

    const next = reviseCareerProfileVersion(previous, revision);

    expect(next.profileVersion).toBe(2);
    expect(next.axisValues[0].preference).toBe(100);
    expect(next.targetRoles).toEqual(["デザイナー", "リサーチャー"]);
    expect(previous.targetRoles).toEqual(["ソフトウェアエンジニア"]);
    expect(next.constraints.allowedPrefectureCodes).toEqual(["01"]);
    expect(previous.profileVersion).toBe(1);
    expect(previous.axisValues[0].preference).toBe(50);
    expect(previous.constraints.allowedPrefectureCodes).toEqual(["13", "27"]);
    expect(next).not.toBe(previous);
  });

  it("rejects an invalid revision before changing the old version", () => {
    const previous = createCareerProfileVersion(profileInput());
    const revision = profileInput();
    revision.axisValues[0].axisVersion = 2;
    expect(() => reviseCareerProfileVersion(previous, revision)).toThrow(
      RangeError,
    );
    expect(previous.axisValues[0].axisVersion).toBe(1);
  });

  it("does not accept a client-supplied version or increment beyond safe integers", () => {
    const previous = createCareerProfileVersion(profileInput());
    const revision = { ...profileInput(), profileVersion: 100 };
    expect(reviseCareerProfileVersion(previous, revision).profileVersion).toBe(
      2,
    );

    const maximum = createCareerProfileVersion({
      ...profileInput(),
      profileVersion: Number.MAX_SAFE_INTEGER,
    });
    expect(() => reviseCareerProfileVersion(maximum, revision)).toThrow(
      RangeError,
    );
  });
});
