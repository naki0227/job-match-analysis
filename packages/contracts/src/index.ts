import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const healthResponse: HealthResponse = { status: "ok" };

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
