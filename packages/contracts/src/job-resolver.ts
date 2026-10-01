import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

export const employmentPreferenceSchema = z.enum([
  "full_time",
  "part_time",
  "contract",
  "intern",
  "new_grad",
]);

/** POST /api/v1/job-resolver/search (ADR-045). */
export const jobSearchRequestSchema = z.strictObject({
  company: text(100),
  roleQuery: text(100),
  employmentType: employmentPreferenceSchema.optional(),
});

/** A posting that discovery actually found; never generated. */
export const jobCandidateSchema = z.strictObject({
  companyName: text(300),
  title: text(300),
  url: z.url({ protocol: /^https$/ }).max(2048),
  source: text(40),
  employmentTypes: z.array(text(40)).max(10),
  location: text(300).optional(),
});

export const jobSearchResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("resolved"),
    candidate: jobCandidateSchema,
    reason: z.enum(["single_full_match", "confident_selection"]),
    partial: z.boolean(),
  }),
  z.strictObject({
    status: z.literal("candidates"),
    candidates: z.array(jobCandidateSchema).min(1).max(3),
    partial: z.boolean(),
  }),
  z.strictObject({ status: z.literal("not_found"), partial: z.boolean() }),
]);

export type EmploymentPreference = z.infer<typeof employmentPreferenceSchema>;
export type JobSearchRequest = z.infer<typeof jobSearchRequestSchema>;
export type JobCandidateView = z.infer<typeof jobCandidateSchema>;
export type JobSearchResponse = z.infer<typeof jobSearchResponseSchema>;
