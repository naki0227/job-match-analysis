import {
  careerAxisKeys,
  careerProfilePayloadSchema,
  type CareerProfilePayload,
} from "@job-match/contracts";

export type AxisKey = (typeof careerAxisKeys)[number];

/** importance null means the user has not answered this axis yet. */
export type AxisDraft = { preference: number; importance: number | null };

export type ProfileDraft = {
  targetRoles: string[];
  axes: Record<AxisKey, AxisDraft>;
  minSalary: string;
  locations: string[];
  fullRemoteRequired: boolean;
};

export const importanceLevels = [
  { value: 0, label: "比較しない" },
  { value: 25, label: "少し" },
  { value: 50, label: "ふつう" },
  { value: 75, label: "重視" },
  { value: 100, label: "とても重視" },
] as const;

export const suggestedRoles = [
  "Backend Engineer",
  "Frontend Engineer",
  "Mobile Engineer",
  "Product Manager",
  "Designer",
  "Sales",
] as const;

export function emptyDraft(): ProfileDraft {
  return {
    targetRoles: [],
    axes: Object.fromEntries(
      careerAxisKeys.map((key) => [key, { preference: 50, importance: null }]),
    ) as Record<AxisKey, AxisDraft>,
    minSalary: "",
    locations: [],
    fullRemoteRequired: false,
  };
}

export function draftFromProfile(profile: CareerProfilePayload): ProfileDraft {
  const draft = emptyDraft();
  for (const axis of profile.axisValues) {
    draft.axes[axis.axisKey] = {
      preference: axis.preference,
      importance: axis.importance,
    };
  }
  return {
    ...draft,
    targetRoles: [...profile.targetRoles],
    minSalary: String(profile.constraints.minSalary?.amount ?? ""),
    locations: [...profile.constraints.allowedPrefectureCodes],
    fullRemoteRequired: profile.constraints.fullRemoteRequired,
  };
}

export function answeredAxes(draft: ProfileDraft): number {
  return careerAxisKeys.filter((key) => draft.axes[key].importance !== null)
    .length;
}

export type DraftIssue = "roles" | "axes" | "salary";

export type DraftResult =
  | { ok: true; payload: CareerProfilePayload }
  | { ok: false; issue: DraftIssue };

/** Converts the draft; the shared schema remains the final gate. */
export function draftToPayload(draft: ProfileDraft): DraftResult {
  const roles = draft.targetRoles.map((role) => role.trim()).filter(Boolean);
  if (roles.length === 0 || new Set(roles).size !== roles.length) {
    return { ok: false, issue: "roles" };
  }
  if (answeredAxes(draft) !== careerAxisKeys.length) {
    return { ok: false, issue: "axes" };
  }
  const salaryText = draft.minSalary.trim();
  const salary = Number(salaryText);
  if (salaryText !== "" && (!Number.isSafeInteger(salary) || salary <= 0)) {
    return { ok: false, issue: "salary" };
  }
  const parsed = careerProfilePayloadSchema.safeParse({
    axisCatalogVersion: 1,
    targetRoles: roles,
    axisValues: careerAxisKeys.map((axisKey) => ({
      axisKey,
      axisVersion: 1,
      preference: draft.axes[axisKey].preference,
      importance: draft.axes[axisKey].importance,
    })),
    constraints: {
      ...(salaryText === ""
        ? {}
        : { minSalary: { amount: salary, currency: "JPY", period: "year" } }),
      allowedPrefectureCodes: [...draft.locations].sort(),
      fullRemoteRequired: draft.fullRemoteRequired,
    },
  });
  return parsed.success
    ? { ok: true, payload: parsed.data }
    : { ok: false, issue: "axes" };
}
