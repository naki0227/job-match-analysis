import { describe, expect, it } from "vitest";
import { getKnownValue, type Observation } from "../src/observation.js";

describe("getKnownValue", () => {
  it("preserves a known zero instead of treating it as missing", () => {
    const fact: Observation<number> = { status: "known", value: 0 };
    expect(getKnownValue(fact)).toBe(0);
  });

  it.each(["unknown", "conflicting"] as const)(
    "does not turn %s information into a hard mismatch",
    (status) => {
      const fact: Observation<number> = { status };
      expect(getKnownValue(fact)).toBeUndefined();
    },
  );

  it("retains a stale value for display while excluding it from current comparison", () => {
    const fact: Observation<number> = { status: "stale", value: 75 };
    expect(fact.value).toBe(75);
    expect(getKnownValue(fact)).toBeUndefined();
  });
});
