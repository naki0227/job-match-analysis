import { expect, test } from "vitest";
import {
  orderAxes,
  safeSourceUrl,
  summarizeTarget,
} from "../src/features/result/match-report";
import { jobAxes } from "./fixtures/match-report";

test("summary counts unknown, conflicting and stale as not yet known", () => {
  expect(summarizeTarget({ status: "comparable", axes: jobAxes })).toEqual({
    close: 1,
    different: 1,
    unknown: 2,
    excluded: 1,
  });
});

test("empty and incompatible targets are summarized safely", () => {
  expect(summarizeTarget({ status: "comparable", axes: [] })).toEqual({
    close: 0,
    different: 0,
    unknown: 0,
    excluded: 0,
  });
  expect(summarizeTarget({ status: "incompatible" })).toBeNull();
});

test("axes are ordered by importance with excluded axes last", () => {
  expect(orderAxes(jobAxes).map((axis) => axis.axisKey)).toEqual([
    "autonomy",
    "customer_contact",
    "work_location",
    "role_breadth",
    "work_change",
  ]);
});

test("only http(s) evidence URLs become links", () => {
  expect(safeSourceUrl("https://jobs.example.com/a")).toBe(
    "https://jobs.example.com/a",
  );
  expect(safeSourceUrl("javascript:alert(1)")).toBeNull();
  expect(safeSourceUrl("not a url")).toBeNull();
});
