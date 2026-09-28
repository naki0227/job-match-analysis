import { z } from "zod";

export const careerAxisKeys = [
  "work_location",
  "autonomy",
  "collaboration",
  "growth_direction",
  "work_change",
  "schedule_flexibility",
  "role_breadth",
  "customer_contact",
] as const;

const axisKeySchema = z.enum(careerAxisKeys);
const percentageSchema = z.number().int().min(0).max(100);
const axisAnswerSchema = z.strictObject({
  axisKey: axisKeySchema,
  axisVersion: z.literal(1),
  preference: percentageSchema,
  importance: percentageSchema,
});

const prefectureCodeSchema = z.string().regex(/^(0[1-9]|[1-3][0-9]|4[0-7])$/);

export const careerProfilePayloadSchema = z
  .strictObject({
    axisCatalogVersion: z.literal(1),
    targetRoles: z.array(z.string().trim().min(1)).min(1),
    axisValues: z.array(axisAnswerSchema).length(careerAxisKeys.length),
    constraints: z.strictObject({
      minSalary: z
        .strictObject({
          amount: z.number().int().positive().safe(),
          currency: z.literal("JPY"),
          period: z.literal("year"),
        })
        .optional(),
      allowedPrefectureCodes: z.array(prefectureCodeSchema),
      fullRemoteRequired: z.boolean(),
    }),
  })
  .superRefine((profile, context) => {
    const axisKeys = profile.axisValues.map((axis) => axis.axisKey);
    if (new Set(axisKeys).size !== careerAxisKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["axisValues"],
        message: "Each assessment axis must be answered once",
      });
    }
    if (new Set(profile.targetRoles).size !== profile.targetRoles.length) {
      context.addIssue({
        code: "custom",
        path: ["targetRoles"],
        message: "Target roles must be unique",
      });
    }
    if (
      new Set(profile.constraints.allowedPrefectureCodes).size !==
      profile.constraints.allowedPrefectureCodes.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["constraints", "allowedPrefectureCodes"],
        message: "Prefecture codes must be unique",
      });
    }
  });

export const commitCareerProfileRequestSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative().safe(),
  idempotencyKey: z.uuid(),
  profile: careerProfilePayloadSchema,
});

export const careerProfileResponseSchema = z.strictObject({
  profileVersionId: z.uuid(),
  profileVersion: z.number().int().positive().safe(),
  profile: careerProfilePayloadSchema,
});

export type CareerProfilePayload = z.infer<typeof careerProfilePayloadSchema>;
export type CommitCareerProfileRequest = z.infer<
  typeof commitCareerProfileRequestSchema
>;
export type CareerProfileResponse = z.infer<typeof careerProfileResponseSchema>;
