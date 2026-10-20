import { describe, expect, it } from "vitest";
import {
  AXIS_CATALOG_VERSION,
  AXIS_KEYS,
  createCareerProfileVersion,
  matchCareerProfile,
  type JobEvaluation,
  type MatchInput,
  type TargetEvaluation,
} from "../src/index.js";

// ADR-053 (Issue #44): commercial relationships never reach the MatchEngine.

const profile = createCareerProfileVersion({
  profileVersion: 1,
  axisCatalogVersion: AXIS_CATALOG_VERSION,
  targetRoles: ["ソフトウェアエンジニア"],
  axisValues: AXIS_KEYS.map((axisKey, index) => ({
    axisKey,
    axisVersion: AXIS_CATALOG_VERSION,
    preference: index % 2 === 0 ? 75 : 10,
    importance: 100,
  })),
  constraints: {
    minSalary: { amount: 5_000_000, currency: "JPY", period: "year" },
    fullRemoteRequired: false,
  },
});

const job: JobEvaluation = {
  axisCatalogVersion: AXIS_CATALOG_VERSION,
  axisValues: [
    {
      axisKey: AXIS_KEYS[0],
      axisVersion: AXIS_CATALOG_VERSION,
      observation: { status: "known", value: 50 },
    },
    {
      axisKey: AXIS_KEYS[1],
      axisVersion: AXIS_CATALOG_VERSION,
      observation: { status: "known", value: 100 },
    },
  ],
  salary: {
    status: "known",
    value: {
      minimum: 3_000_000,
      maximum: 4_000_000,
      currency: "JPY",
      period: "year",
    },
  },
};

const company: TargetEvaluation = {
  axisCatalogVersion: AXIS_CATALOG_VERSION,
  axisValues: [],
};

const commercial = {
  partnership: true,
  sponsorship: { tier: "gold", listingFee: 1_000_000 },
  sponsored: true,
  partnerId: "partner-1",
  promoted: true,
};

describe("Match neutrality (ADR-053)", () => {
  it("returns the same result whether or not partner metadata is attached", () => {
    const plain: MatchInput = { profile, job, company };
    const withPartner = {
      profile,
      job: { ...job, ...commercial },
      company: { ...company, ...commercial },
      ...commercial,
    } as MatchInput;

    const expected = matchCareerProfile(plain);
    expect(matchCareerProfile(withPartner)).toEqual(expected);
    // The fixture really covers close, different, unknown and a hard conflict.
    expect(expected.hasHardConflict).toBe(true);
    expect(JSON.stringify(expected)).toMatch(/"close"/);
    expect(JSON.stringify(expected)).toMatch(/"different"/);
    expect(JSON.stringify(expected)).toMatch(/"unknown"/);
  });
});
