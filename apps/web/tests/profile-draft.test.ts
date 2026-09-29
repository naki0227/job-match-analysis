import { careerAxisKeys } from "@job-match/contracts";
import { expect, test } from "vitest";
import {
  answeredAxes,
  draftFromProfile,
  draftToPayload,
  emptyDraft,
  type ProfileDraft,
} from "../src/features/career-profile/profile-draft";

function answered(): ProfileDraft {
  const draft = emptyDraft();
  draft.targetRoles = [" Backend Engineer "];
  for (const key of careerAxisKeys) {
    draft.axes[key] = { preference: 50, importance: 50 };
  }
  return draft;
}

test("an empty draft has no answered axes and cannot be saved", () => {
  const draft = emptyDraft();
  expect(answeredAxes(draft)).toBe(0);
  expect(draftToPayload(draft)).toEqual({ ok: false, issue: "roles" });
  draft.targetRoles = ["Designer"];
  expect(draftToPayload(draft)).toEqual({ ok: false, issue: "axes" });
});

test("0 and 100 survive the conversion and an empty salary is omitted", () => {
  const draft = answered();
  draft.axes.work_location = { preference: 0, importance: 100 };
  draft.axes.autonomy = { preference: 100, importance: 0 };
  draft.locations = ["27", "13"];
  const result = draftToPayload(draft);
  if (!result.ok) throw new Error(result.issue);
  expect(result.payload.targetRoles).toEqual(["Backend Engineer"]);
  expect(result.payload.axisValues[0]).toMatchObject({
    axisKey: "work_location",
    preference: 0,
    importance: 100,
  });
  expect(result.payload.axisValues[1]).toMatchObject({
    preference: 100,
    importance: 0,
  });
  expect(result.payload.constraints).toEqual({
    allowedPrefectureCodes: ["13", "27"],
    fullRemoteRequired: false,
  });
});

test("invalid salaries and duplicate roles are rejected", () => {
  for (const salary of ["0", "-1", "12.5", "abc"]) {
    const draft = answered();
    draft.minSalary = salary;
    expect(draftToPayload(draft)).toEqual({ ok: false, issue: "salary" });
  }
  const draft = answered();
  draft.targetRoles = ["Designer", "Designer "];
  expect(draftToPayload(draft)).toEqual({ ok: false, issue: "roles" });
});

test("a saved profile round-trips through the draft", () => {
  const result = draftToPayload({ ...answered(), minSalary: "5000000" });
  if (!result.ok) throw new Error(result.issue);
  expect(draftToPayload(draftFromProfile(result.payload))).toEqual(result);
});
