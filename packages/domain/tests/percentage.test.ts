import { describe, expect, it } from "vitest";
import { parsePercentage } from "../src/percentage.js";

describe("parsePercentage", () => {
  it.each([0, 50, 100])("accepts %i", (value) => {
    expect(parsePercentage(value)).toBe(value);
  });

  it.each([
    -1,
    101,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "50",
    null,
    undefined,
  ])("rejects an invalid value: %s", (value) => {
    expect(() => parsePercentage(value)).toThrow(RangeError);
  });
});
