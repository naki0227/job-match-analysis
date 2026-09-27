import { describe, expect, it } from "vitest";
import { PREFECTURE_CODES, parsePrefectureCode } from "../src/prefecture.js";

describe("prefecture codes", () => {
  it("contains 47 unique two-digit codes", () => {
    expect(PREFECTURE_CODES).toHaveLength(47);
    expect(new Set(PREFECTURE_CODES).size).toBe(47);
    expect(PREFECTURE_CODES[0]).toBe("01");
    expect(PREFECTURE_CODES[46]).toBe("47");
  });

  it("accepts valid codes without coercion", () => {
    expect(parsePrefectureCode("01")).toBe("01");
    expect(parsePrefectureCode("13")).toBe("13");
    expect(parsePrefectureCode("47")).toBe("47");
  });

  it.each(["00", "48", "1", 13, null])("rejects %s", (value) => {
    expect(() => parsePrefectureCode(value)).toThrow(RangeError);
  });
});
