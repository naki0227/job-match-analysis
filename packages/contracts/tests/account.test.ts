import { describe, expect, it } from "vitest";
import { deleteAccountRequestSchema } from "../src/account.js";

describe("account deletion contract", () => {
  it("accepts only the explicit confirmation", () => {
    expect(
      deleteAccountRequestSchema.safeParse({
        confirmation: "delete-my-account",
      }).success,
    ).toBe(true);
    for (const body of [
      {},
      { confirmation: "yes" },
      { confirmation: "delete-my-account", userId: "x" },
    ]) {
      expect(deleteAccountRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});
