import { z } from "zod";

/**
 * Account deletion must name its intent explicitly, so a stray or scripted
 * DELETE without this body cannot remove an account.
 */
export const deleteAccountRequestSchema = z.strictObject({
  confirmation: z.literal("delete-my-account"),
});

export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;
