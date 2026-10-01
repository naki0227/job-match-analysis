import { describe, expect, it } from "vitest";
import {
  decideResolution,
  employmentFits,
  normalizeCompanyName,
  rankCandidates,
  roleTerms,
  sameCompany,
  type CandidateSelection,
  type JobCandidate,
} from "../src/job-resolution.js";

const candidate = (
  title: string,
  extra: Partial<JobCandidate> = {},
): JobCandidate => ({
  companyName: "株式会社マネーフォワード",
  title,
  url: `https://ats.example/jobs/${encodeURIComponent(title)}`,
  source: "known",
  employmentTypes: [],
  ...extra,
});

const postings = [
  candidate("【新卒】エンジニア"),
  candidate("Backend Developer (Go)", { employmentTypes: ["FULL_TIME"] }),
  candidate("フロントエンドエンジニア"),
  candidate("法人営業（中途）"),
  candidate("Backend Developer (Go)", { companyName: "Other Inc." }),
];

describe("company and role matching", () => {
  it("ignores legal forms, width and spacing in company names", () => {
    expect(normalizeCompanyName("株式会社 マネーフォワード")).toBe(
      "マネーフォワード",
    );
    expect(sameCompany("マネーフォワード", "㈱マネーフォワード")).toBe(true);
    expect(sameCompany("Money Forward", "Money Forward, Inc.")).toBe(true);
    expect(sameCompany("マネーフォワード", "Other Inc.")).toBe(false);
    expect(sameCompany("株式会社", "株式会社サンプル")).toBe(false);
  });

  it("splits role queries into distinct folded terms", () => {
    expect(roleTerms("Backend  Go・バックエンド／Ｇｏ")).toEqual([
      "backend",
      "go",
      "バックエンド",
    ]);
  });

  it("uses declared employment types first and never guesses a missing one", () => {
    expect(employmentFits(postings[1]!, "full_time")).toBe(true);
    expect(employmentFits(postings[1]!, "intern")).toBe(false);
    expect(employmentFits(postings[0]!, "new_grad")).toBe(true);
    expect(employmentFits(postings[3]!, "new_grad")).toBe(false);
    expect(employmentFits(postings[2]!, "new_grad")).toBeNull();
    expect(employmentFits(postings[2]!, undefined)).toBeNull();
  });
});

describe("mechanical narrowing", () => {
  it("keeps the same company, drops contradicted employment and ranks by role terms", () => {
    const ranked = rankCandidates(
      {
        company: "マネーフォワード",
        roleQuery: "Backend Go",
        employmentType: "full_time",
      },
      [...postings, postings[1]!],
      10,
    );
    expect(
      ranked.map((item) => [item.id, item.title, item.matchedTerms]),
    ).toEqual([
      ["c1", "Backend Developer (Go)", 2],
      ["c2", "フロントエンドエンジニア", 0],
      ["c3", "法人営業（中途）", 0],
    ]);
  });

  it("caps the candidate set before any semantic selection", () => {
    expect(
      rankCandidates(
        { company: "マネーフォワード", roleQuery: "x" },
        postings,
        2,
      ),
    ).toHaveLength(2);
  });
});

describe("resolution policy", () => {
  const ranked = rankCandidates(
    { company: "マネーフォワード", roleQuery: "Backend Go" },
    postings,
    10,
  );

  it("finds nothing without candidates", () => {
    expect(decideResolution([], null)).toEqual({
      status: "not_found",
      reason: "no_candidates",
    });
  });

  it("resolves mechanically when exactly one title contains every role term", () => {
    expect(decideResolution(ranked, null)).toMatchObject({
      status: "resolved",
      reason: "single_full_match",
      candidate: { title: "Backend Developer (Go)" },
    });
    const generic = rankCandidates(
      { company: "マネーフォワード", roleQuery: "エンジニア" },
      postings,
      10,
    );
    expect(decideResolution(generic, null)).toMatchObject({
      status: "candidates",
      reason: "ambiguous",
    });
    expect(decideResolution(ranked.slice(1, 2), null)).toMatchObject({
      status: "candidates",
      reason: "ambiguous",
    });
  });

  it("resolves a confident selection with no close runner-up", () => {
    const partial = ranked.slice(1);
    const result = decideResolution(partial, {
      choice: "c2",
      confidence: 0.9,
      probabilities: { c2: 0.88, c3: 0.07, none: 0.05 },
    });
    expect(result).toMatchObject({
      status: "resolved",
      reason: "confident_selection",
    });
  });

  it("returns the top choices when the selection is unsure, split or unknown", () => {
    const ranked = rankCandidates(
      { company: "マネーフォワード", roleQuery: "エンジニア" },
      postings,
      10,
    );
    const selections: CandidateSelection[] = [
      { choice: "c1", confidence: 0.7, probabilities: { c1: 0.7, c2: 0.3 } },
      { choice: "c1", confidence: 0.9, probabilities: { c1: 0.8, c3: 0.2 } },
      { choice: "c9", confidence: 0.95, probabilities: { c9: 0.95 } },
      {
        choice: "none",
        confidence: 0.9,
        probabilities: { none: 0.9, c3: 0.1 },
      },
    ];
    for (const selection of selections) {
      const result = decideResolution(ranked, selection);
      expect(result.status).toBe("candidates");
      if (result.status === "candidates") {
        expect(result.candidates.length).toBeLessThanOrEqual(3);
        expect(ranked).toEqual(expect.arrayContaining([...result.candidates]));
      }
    }
    const reordered = decideResolution(ranked, {
      choice: "c3",
      confidence: 0.6,
      probabilities: { c3: 0.6, c2: 0.3, c1: 0.1 },
    });
    expect(
      reordered.status === "candidates" &&
        reordered.candidates.map((item) => item.id),
    ).toEqual(["c3", "c2", "c1"]);
  });
});
