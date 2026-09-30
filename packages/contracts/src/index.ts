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
  analysisHistoryItemSchema,
  analysisHistoryPageSchema,
  analysisHistoryQuerySchema,
  historyJudgementSchema,
  historySortSchema,
} from "./analysis-history.js";
export type {
  AnalysisHistoryItem,
  AnalysisHistoryPage,
  AnalysisHistoryQuery,
} from "./analysis-history.js";

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

export {
  matchShareSchema,
  publicShareSchema,
  shareTokenSchema,
  sharedMatchSchema,
  summarizeSharedMatch,
  toSharedMatch,
} from "./shares.js";
export type {
  MatchShare,
  PublicShare,
  SharedMatch,
  SharedMatchSummary,
} from "./shares.js";

export { deleteAccountRequestSchema } from "./account.js";
export type { DeleteAccountRequest } from "./account.js";

export { axisDisplayNames, axisStatusDisplayLabels } from "./labels.js";
