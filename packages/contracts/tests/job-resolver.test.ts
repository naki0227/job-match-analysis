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
      { company: "a", roleQuery: "b".repeat(101) },
      { company: "a", roleQuery: "b", employmentType: "freelance" },
      { company: "a", roleQuery: "b", url: "https://x.example" },
    ]) {
      expect(jobSearchRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("only carries https candidates and at most three choices", () => {
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
        candidates: [candidate, candidate, candidate, candidate],
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
