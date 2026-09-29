import { describe, expect, it } from "vitest";
import {
  analysisJobIdSchema,
  analysisJobResponseSchema,
  analysisPostResponseSchema,
  requestAnalysisSchema,
} from "../src/analyses.js";

const id = "33333333-3333-4333-8333-333333333333";
const fetchedAt = "2026-09-29T00:00:00Z";

describe("analysis API contracts", () => {
  it("requires one HTTPS URL and rejects client identity or profile data", () => {
    expect(
      requestAnalysisSchema.safeParse({ url: "https://jobs.example/1" })
        .success,
    ).toBe(true);
    for (const input of [
      { url: "http://jobs.example/1" },
      { url: "https://jobs.example/1", userId: id },
      { url: "https://jobs.example/1", profile: {} },
    ]) {
      expect(requestAnalysisSchema.safeParse(input).success).toBe(false);
    }
  });

  it("models fresh, stale and pending without mixing personal state", () => {
    expect(
      analysisPostResponseSchema.safeParse({
        status: "completed",
        evaluationId: id,
        sourceFetchedAt: fetchedAt,
      }).success,
    ).toBe(true);
    expect(
      analysisPostResponseSchema.safeParse({
        status: "stale",
        evaluationId: id,
        sourceFetchedAt: fetchedAt,
        refreshJobId: id,
      }).success,
    ).toBe(true);
    expect(
      analysisPostResponseSchema.safeParse({ status: "pending", jobId: id })
        .success,
    ).toBe(true);
    expect(
      analysisPostResponseSchema.safeParse({
        status: "pending",
        jobId: id,
        userId: id,
      }).success,
    ).toBe(false);
  });

  it("requires an evaluation ID only for completed jobs", () => {
    expect(analysisJobIdSchema.safeParse(id).success).toBe(true);
    expect(analysisJobIdSchema.safeParse("invalid").success).toBe(false);
    for (const status of ["queued", "running", "failed"] as const) {
      expect(
        analysisJobResponseSchema.safeParse({ status, jobId: id }).success,
      ).toBe(true);
    }
    expect(
      analysisJobResponseSchema.safeParse({
        status: "completed",
        jobId: id,
        evaluationId: id,
      }).success,
    ).toBe(true);
    expect(
      analysisJobResponseSchema.safeParse({ status: "completed", jobId: id })
        .success,
    ).toBe(false);
  });
});
