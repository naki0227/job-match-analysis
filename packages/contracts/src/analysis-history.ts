import { z } from "zod";

export const historyJudgementSchema = z.enum([
  "all",
  "mostly_close",
  "has_different",
  "has_unknown",
]);

export const historySortSchema = z.enum(["recent", "close", "fewest_unknown"]);

export const analysisHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(1024).optional(),
  role: z.string().trim().min(1).max(512).optional(),
  judgement: historyJudgementSchema.default("all"),
  sort: historySortSchema.default("recent"),
});

export const analysisHistoryItemSchema = z.object({
  jobPostingId: z.uuid(),
  matchResultId: z.uuid(),
  analyzedAt: z.iso.datetime({ offset: true }),
  careerProfileVersionId: z.uuid(),
  profileVersion: z.number().int().positive(),
  targetRoles: z.array(z.string().min(1)),
  jobTitle: z.string(),
  companyId: z.uuid(),
  companyName: z.string(),
  jobEvaluationId: z.uuid(),
  jobEvaluatedAt: z.iso.datetime({ offset: true }),
  companyEvaluationId: z.uuid().nullable(),
  companyEvaluatedAt: z.iso.datetime({ offset: true }).nullable(),
  summary: z.object({
    close: z.number().int().nonnegative(),
    different: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  staleConditions: z.boolean(),
});

export const analysisHistoryPageSchema = z.object({
  items: z.array(analysisHistoryItemSchema),
  nextCursor: z.string().nullable(),
});

export type AnalysisHistoryQuery = z.infer<typeof analysisHistoryQuerySchema>;
export type AnalysisHistoryItem = z.infer<typeof analysisHistoryItemSchema>;
export type AnalysisHistoryPage = z.infer<typeof analysisHistoryPageSchema>;
