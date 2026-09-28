import { describe, expect, test } from "vitest";
import { healthResponse, healthResponseSchema } from "../src/index.js";

describe("health response contract", () => {
  test("accepts the API response", () => {
    expect(healthResponseSchema.parse(healthResponse)).toEqual({
      status: "ok",
    });
  });

  test("rejects a malformed response", () => {
    expect(healthResponseSchema.safeParse({ status: "failed" }).success).toBe(
      false,
    );
    expect(healthResponseSchema.safeParse({}).success).toBe(false);
  });
});
