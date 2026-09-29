import { z } from "zod";
import { careerAxisKeys } from "./career-profile.js";

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const percentage = z.number().int().min(0).max(100);

export const matchAxisStatuses = [
  "close",
  "different",
  "excluded",
  "unknown",
  "conflicting",
  "stale",
] as const;
export const matchConstraintKinds = [
  "min_salary",
  "location",
  "full_remote",
] as const;
export const matchConstraintStatuses = [
  "met",
  "unmet",
  "unknown",
  "not_required",
] as const;
export const matchConstraintReasons = [
  "missing_information",
  "conflicting_information",
  "stale_information",
  "salary_unit_mismatch",
  "salary_range_overlaps_minimum",
  "salary_below_minimum",
  "location_outside_allowed",
  "regular_office_attendance_required",
] as const;

export const createMatchRequestSchema = z.strictObject({
  evaluationId: uuid,
});

export const matchEvidenceSchema = z.strictObject({
  quote: z.string().trim().min(1),
  sourceUrl: z.url(),
  fetchedAt: timestamp,
});

export const matchAxisResultSchema = z.strictObject({
  axisKey: z.enum(careerAxisKeys),
  status: z.enum(matchAxisStatuses),
  preference: percentage,
  importance: percentage,
  observed: z.union([z.literal(0), z.literal(50), z.literal(100)]).nullable(),
  evidence: z.array(matchEvidenceSchema),
});

export const matchTargetResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("comparable"),
    evaluationId: uuid,
    evaluatedAt: timestamp,
    axes: z.array(matchAxisResultSchema).length(careerAxisKeys.length),
  }),
  z.strictObject({
    status: z.literal("incompatible"),
    evaluationId: uuid,
    evaluatedAt: timestamp,
  }),
]);

export const matchConstraintResultSchema = z.strictObject({
  kind: z.enum(matchConstraintKinds),
  status: z.enum(matchConstraintStatuses),
  reason: z.enum(matchConstraintReasons).optional(),
});

/** Personal comparison of one profile version with one job evaluation. */
export const matchReportSchema = z.strictObject({
  matchResultId: uuid,
  createdAt: timestamp,
  profileVersion: z.number().int().positive().safe(),
  algorithmVersion: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  jobTitle: z.string().trim().min(1),
  job: matchTargetResultSchema,
  company: matchTargetResultSchema.nullable(),
  hardConstraints: z
    .array(matchConstraintResultSchema)
    .length(matchConstraintKinds.length),
});

export type CreateMatchRequest = z.infer<typeof createMatchRequestSchema>;
export type MatchEvidence = z.infer<typeof matchEvidenceSchema>;
export type MatchAxisResult = z.infer<typeof matchAxisResultSchema>;
export type MatchTargetResult = z.infer<typeof matchTargetResultSchema>;
export type MatchConstraintResult = z.infer<typeof matchConstraintResultSchema>;
export type MatchReport = z.infer<typeof matchReportSchema>;
