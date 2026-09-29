import { expect, it } from "vitest";
import {
  AXIS_CATALOG_VERSION,
  PUBLIC_AXIS_RUBRICS,
  PUBLIC_RUBRIC_VERSION,
} from "../src/assessment-rubric.js";
import { validateDecisionInput } from "../src/decision-engine.js";

it("keeps all eight published axes in one versioned rubric", () => {
  expect(AXIS_CATALOG_VERSION).toBe(1);
  expect(PUBLIC_RUBRIC_VERSION).toBe("public-anchors-v1");
  expect(PUBLIC_AXIS_RUBRICS.map((item) => item.axisKey)).toEqual([
    "work_location",
    "autonomy",
    "collaboration",
    "growth_direction",
    "work_change",
    "schedule_flexibility",
    "role_breadth",
    "customer_contact",
  ]);
  expect(() =>
    validateDecisionInput({
      axisCatalogVersion: AXIS_CATALOG_VERSION,
      rubricVersion: PUBLIC_RUBRIC_VERSION,
      scope: "job",
      rubrics: PUBLIC_AXIS_RUBRICS,
      candidates: [],
    }),
  ).not.toThrow();
});
