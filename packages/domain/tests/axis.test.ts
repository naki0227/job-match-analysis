import { describe, expect, it } from "vitest";
import {
  AXIS_CATALOG_VERSION,
  AXIS_KEYS,
  parseAxisCatalogVersion,
  parseAxisKey,
} from "../src/axis.js";

describe("assessment axis catalog", () => {
  it("contains the eight approved axes without duplicates", () => {
    expect(AXIS_KEYS).toHaveLength(8);
    expect(new Set(AXIS_KEYS).size).toBe(8);
  });

  it("accepts a catalog key and its version", () => {
    expect(parseAxisKey("customer_contact")).toBe("customer_contact");
    expect(parseAxisCatalogVersion(AXIS_CATALOG_VERSION)).toBe(1);
  });

  it("rejects an unknown key or unsupported version", () => {
    expect(() => parseAxisKey("salary")).toThrow(RangeError);
    expect(() => parseAxisCatalogVersion(2)).toThrow(RangeError);
  });
});
