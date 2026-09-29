import { z } from "zod";

const uuid = z.uuid();
const fetchedAt = z.iso.datetime({ offset: true });

export const analysisJobIdSchema = uuid;

export const requestAnalysisSchema = z.strictObject({
  url: z.url({ protocol: /^https$/ }).max(2048),
});

export const analysisPostResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("completed"),
    evaluationId: uuid,
    sourceFetchedAt: fetchedAt,
  }),
  z.strictObject({
    status: z.literal("stale"),
    evaluationId: uuid,
    sourceFetchedAt: fetchedAt,
    refreshJobId: uuid,
  }),
  z.strictObject({ status: z.literal("pending"), jobId: uuid }),
]);

export const analysisJobResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("queued"), jobId: uuid }),
  z.strictObject({ status: z.literal("running"), jobId: uuid }),
  z.strictObject({
    status: z.literal("completed"),
    jobId: uuid,
    evaluationId: uuid,
  }),
  z.strictObject({ status: z.literal("failed"), jobId: uuid }),
]);

export type RequestAnalysis = z.infer<typeof requestAnalysisSchema>;
export type AnalysisPostResponse = z.infer<typeof analysisPostResponseSchema>;
export type AnalysisJobResponse = z.infer<typeof analysisJobResponseSchema>;
