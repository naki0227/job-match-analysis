import { describe, expect, it } from "vitest";
import { careerAxisKeys } from "../src/career-profile.js";
import { axisDisplayNames, axisStatusDisplayLabels } from "../src/labels.js";
import { matchAxisStatuses } from "../src/matches.js";

describe("shared display labels", () => {
  it("names every axis and status without numbers or scores", () => {
    expect(Object.keys(axisDisplayNames).sort()).toEqual(
      [...careerAxisKeys].sort(),
    );
    expect(Object.keys(axisStatusDisplayLabels).sort()).toEqual(
      [...matchAxisStatuses].sort(),
    );
    for (const label of Object.values(axisStatusDisplayLabels)) {
      expect(label).not.toMatch(/[0-9%％]/);
    }
  });
});
