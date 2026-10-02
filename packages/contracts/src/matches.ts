import { z } from "zod";
import { careerAxisKeys } from "./career-profile.js";

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const percentage = z.number().int().min(0).max(100);

export const matchAxisStatuses = [
  "close",
  "different",
  "partial",
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
  /**
   * Set when the posting supports two adjacent anchors rather than one
   * (ADR-049); `observed` is then null. Optional for older reports.
   */
  observedRange: z
    .union([
      z.strictObject({ minimum: z.literal(0), maximum: z.literal(50) }),
      z.strictObject({ minimum: z.literal(50), maximum: z.literal(100) }),
    ])
    .nullable()
    .optional(),
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

const unknownFactSchema = z.strictObject({ status: z.literal("unknown") });
const conflictingFactSchema = z.strictObject({
  status: z.literal("conflicting"),
});
/** The page text a known fact was read from, so users can check it. */
const evidence = z.string().trim().min(1).optional();
const salaryOverviewSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("known"),
    minimum: z.number().int().nonnegative().safe(),
    maximum: z.number().int().nonnegative().safe(),
    currency: z.string().trim().min(1),
    period: z.string().trim().min(1),
    evidence,
  }),
  unknownFactSchema,
  conflictingFactSchema,
]);
const stringListOverviewSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("known"),
    values: z.array(z.string().trim().min(1)).min(1),
    evidence,
  }),
  unknownFactSchema,
  conflictingFactSchema,
]);
const booleanOverviewSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("known"), value: z.boolean(), evidence }),
  unknownFactSchema,
  conflictingFactSchema,
]);
const officeDaysOverviewSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("known"),
    value: z.number().int().min(0).max(5),
    evidence,
  }),
  unknownFactSchema,
  conflictingFactSchema,
]);
const flexibilityOverviewSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("known"),
    value: z.union([z.literal(0), z.literal(50), z.literal(100)]),
    evidence,
  }),
  unknownFactSchema,
  conflictingFactSchema,
]);
/**
 * A part of the posting in its own words: quotes in page order, each with
 * the heading or row label it appeared under (null when it had none).
 */
const sectionOverviewSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("known"),
    quotes: z
      .array(
        z.strictObject({
          section: z.string().trim().min(1).nullable(),
          text: z.string().trim().min(1),
        }),
      )
      .min(1),
  }),
  unknownFactSchema,
]);

/**
 * What the job posting itself says, before any comparison with the user.
 * The sections are optional so a report from an API without them still
 * parses; their absence means the same as unknown.
 */
export const jobOverviewSchema = z.strictObject({
  salary: salaryOverviewSchema,
  locations: stringListOverviewSchema,
  employmentTypes: stringListOverviewSchema,
  fullRemote: booleanOverviewSchema,
  weeklyOfficeDays: officeDaysOverviewSchema,
  scheduleFlexibility: flexibilityOverviewSchema,
  techStack: stringListOverviewSchema,
  duties: sectionOverviewSchema.optional(),
  requirements: sectionOverviewSchema.optional(),
  workStyle: sectionOverviewSchema.optional(),
});

/** Personal comparison of one profile version with one job evaluation. */
export const matchReportSchema = z.strictObject({
  matchResultId: uuid,
  createdAt: timestamp,
  profileVersion: z.number().int().positive().safe(),
  algorithmVersion: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  jobTitle: z.string().trim().min(1),
  jobOverview: jobOverviewSchema,
  job: matchTargetResultSchema,
  company: matchTargetResultSchema.nullable(),
  hardConstraints: z
    .array(matchConstraintResultSchema)
    .length(matchConstraintKinds.length),
});

export type CreateMatchRequest = z.infer<typeof createMatchRequestSchema>;
export type MatchEvidence = z.infer<typeof matchEvidenceSchema>;
export type JobOverview = z.infer<typeof jobOverviewSchema>;
export type JobSectionOverview = z.infer<typeof sectionOverviewSchema>;
export type MatchAxisResult = z.infer<typeof matchAxisResultSchema>;
export type MatchTargetResult = z.infer<typeof matchTargetResultSchema>;
export type MatchConstraintResult = z.infer<typeof matchConstraintResultSchema>;
export type MatchReport = z.infer<typeof matchReportSchema>;
