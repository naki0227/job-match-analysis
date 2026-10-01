import { describe, expect, it } from "vitest";
import {
  jobSearchRequestSchema,
  jobSearchResponseSchema,
} from "../src/job-resolver.js";

const candidate = {
  companyName: "サンプル株式会社",
  title: "法人営業",
  url: "https://ats.example/jobs/1",
  source: "known",
  employmentTypes: ["FULL_TIME"],
};

describe("job resolver contract", () => {
  it("accepts company, role and an optional employment type", () => {
    expect(
      jobSearchRequestSchema.parse({
        company: " マネーフォワード ",
        roleQuery: "Backend Go",
        employmentType: "new_grad",
      }),
    ).toEqual({
      company: "マネーフォワード",
      roleQuery: "Backend Go",
      employmentType: "new_grad",
    });
    for (const invalid of [
      { company: "", roleQuery: "営業" },
      { company: "a", roleQuery: 1 },
      { company: "a", roleQuery: "b".repeat(101) },
      { company: "a", roleQuery: "b", employmentType: "freelance" },
      { company: "a", roleQuery: "b", url: "https://x.example" },
    ]) {
      expect(jobSearchRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("lets the role be omitted for a company-only listing", () => {
    expect(jobSearchRequestSchema.parse({ company: "a" })).toEqual({
      company: "a",
    });
    expect(
      jobSearchRequestSchema.parse({ company: "a", roleQuery: "  " }),
    ).toEqual({
      company: "a",
    });
  });

  it("only carries https candidates and a bounded list", () => {
    expect(
      jobSearchResponseSchema.safeParse({
        status: "resolved",
        candidate,
        reason: "confident_selection",
        partial: false,
      }).success,
    ).toBe(true);
    expect(
      jobSearchResponseSchema.safeParse({
        status: "resolved",
        candidate: { ...candidate, url: "http://ats.example/1" },
        reason: "confident_selection",
        partial: false,
      }).success,
    ).toBe(false);
    expect(
      jobSearchResponseSchema.safeParse({
        status: "candidates",
        candidates: Array.from({ length: 21 }, () => candidate),
        hasMore: true,
        partial: false,
      }).success,
    ).toBe(false);
    expect(
      jobSearchResponseSchema.parse({ status: "not_found", partial: true }),
    ).toEqual({
      status: "not_found",
      partial: true,
    });
  });
});

describe("discovery polling", () => {
  it("reports a running discovery by id only", () => {
    expect(
      jobSearchResponseSchema.safeParse({
        status: "searching",
        discoveryId: "46100000-0000-4000-8000-000000000001",
        partial: false,
      }).success,
    ).toBe(true);
    expect(
      jobSearchResponseSchema.safeParse({
        status: "searching",
        discoveryId: "x",
        partial: false,
      }).success,
    ).toBe(false);
  });
});
