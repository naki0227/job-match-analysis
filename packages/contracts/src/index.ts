import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const healthResponse: HealthResponse = { status: "ok" };

export {
  analysisJobIdSchema,
  analysisJobResponseSchema,
  analysisPostResponseSchema,
  requestAnalysisSchema,
} from "./analyses.js";
export type {
  AnalysisJobResponse,
  AnalysisPostResponse,
  RequestAnalysis,
} from "./analyses.js";

export {
  careerAxisKeys,
  careerProfilePayloadSchema,
  careerProfileResponseSchema,
  commitCareerProfileRequestSchema,
} from "./career-profile.js";
export type {
  CareerProfilePayload,
  CareerProfileResponse,
  CommitCareerProfileRequest,
} from "./career-profile.js";

export {
  createMatchRequestSchema,
  matchAxisResultSchema,
  matchAxisStatuses,
  matchConstraintKinds,
  matchConstraintReasons,
  matchConstraintResultSchema,
  matchConstraintStatuses,
  matchEvidenceSchema,
  matchReportSchema,
  matchTargetResultSchema,
} from "./matches.js";
export type {
  CreateMatchRequest,
  MatchAxisResult,
  MatchConstraintResult,
  MatchEvidence,
  MatchReport,
  MatchTargetResult,
} from "./matches.js";
