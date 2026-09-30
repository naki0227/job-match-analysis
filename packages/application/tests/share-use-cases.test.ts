import { careerAxisKeys, type SharedMatch } from "@job-match/contracts";
import type { AxisComparison } from "@job-match/domain";
import { describe, expect, it, vi } from "vitest";
import {
  MATCH_ALGORITHM_VERSION,
  createShare,
  readPublicShare,
  revokeShare,
  type MatchEvaluationSource,
  type SharePorts,
  type StoredMatch,
} from "../src/index.js";

const userId = "11111111-1111-4111-8111-111111111111";
const matchResultId = "55555555-5555-4555-8555-555555555555";
const evaluationId = "33333333-3333-4333-8333-333333333333";
const shareId = "66666666-6666-4666-8666-666666666666";
const at = "2026-09-29T00:00:00Z";
const token = "t".repeat(43);

const stored: StoredMatch = {
  matchResultId,
  createdAt: at,
  algorithmVersion: MATCH_ALGORITHM_VERSION,
  evaluationId,
  profileVersion: 4,
  axisCatalogVersion: 1,
  axes: careerAxisKeys.map((axisKey): AxisComparison => ({
    axisKey,
    source: "job",
    preference: 91,
    importance: 73,
    observation: { status: "known", value: 100 },
    status: "close",
    difference: 9,
  })),
  constraints: [
    { kind: "min_salary", status: "unmet", reason: "salary_below_minimum" },
    { kind: "location", status: "not_required" },
    { kind: "full_remote", status: "not_required" },
  ],
};

const source: MatchEvaluationSource = {
  targetType: "job",
  companyName: "サンプルテック株式会社",
  jobTitle: "Backend Engineer",
  evaluation: {
    evaluationId,
    evaluatedAt: at,
    axisCatalogVersion: 1,
    axisValues: [],
    evidence: [
      {
        axisKey: "autonomy",
        quote: "年収720万円",
        sourceUrl: "https://jobs.example/1",
        fetchedAt: at,
      },
    ],
  },
  companyEvaluation: null,
};

function ports(overrides: Partial<SharePorts> = {}): SharePorts {
  return {
    readMatch: vi.fn(async () => stored),
    readEvaluation: vi.fn(async () => source),
    newToken: () => token,
    createShare: vi.fn(async () => ({
      shareId,
      token,
      sharedAt: at,
      created: true,
    })),
    readActiveShare: vi.fn(async () => null),
    revokeShare: vi.fn(async () => true),
    readPublicShare: vi.fn(async () => null),
    ...overrides,
  };
}

describe("createShare", () => {
  it("stores only the public projection of the caller's Match", async () => {
    const deps = ports();
    const result = await createShare(deps, { userId, matchResultId });
    if (result.status !== "created") throw new Error(result.status);
    expect(deps.readMatch).toHaveBeenCalledWith(userId, matchResultId);
    const call = vi.mocked(deps.createShare).mock.calls[0]![0];
    expect(call).toMatchObject({ userId, matchResultId, token });
    const serialized = JSON.stringify(call.projection);
    for (const secret of ["91", "73", "720万円", "salary", "profileVersion"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(result.share.projection.axes).toHaveLength(8);
    expect(result.share.projection.axes[0]).toEqual({
      axisKey: "work_location",
      status: "close",
    });
  });

  it("returns the existing live link unchanged", async () => {
    const existingProjection: SharedMatch = {
      companyName: "サンプルテック株式会社",
      jobTitle: "Backend Engineer",
      evaluatedAt: at,
      axes: careerAxisKeys.map((axisKey) => ({ axisKey, status: "unknown" })),
    };
    const result = await createShare(
      ports({
        createShare: async () => ({
          shareId,
          token: "o".repeat(43),
          sharedAt: at,
          created: false,
        }),
        readActiveShare: async () => ({
          shareId,
          token: "o".repeat(43),
          sharedAt: at,
          projection: existingProjection,
        }),
      }),
      { userId, matchResultId },
    );
    expect(result).toMatchObject({
      status: "existing",
      share: { token: "o".repeat(43), projection: existingProjection },
    });
  });

  it("does not share another user's or a missing Match", async () => {
    const deps = ports({ readMatch: async () => null });
    expect(await createShare(deps, { userId, matchResultId })).toEqual({
      status: "not_found",
    });
    expect(deps.createShare).not.toHaveBeenCalled();
  });

  it("delegates revocation and public reads without identifiers", async () => {
    const deps = ports();
    expect(await revokeShare(deps, { userId, shareId })).toBe(true);
    expect(deps.revokeShare).toHaveBeenCalledWith(userId, shareId);
    expect(await readPublicShare(deps, token)).toBeNull();
    expect(deps.readPublicShare).toHaveBeenCalledWith(token);
  });
});
