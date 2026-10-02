import {
  axisDisplayNames,
  axisStatusDisplayLabels,
  type MatchAxisResult,
  type MatchConstraintResult,
  type MatchReport,
  type MatchTargetResult,
} from "@job-match/contracts";

/** Display helpers for the shared match report contract. */
export type AxisResult = MatchAxisResult;
export type AxisKey = AxisResult["axisKey"];
export type AxisStatus = AxisResult["status"];
export type Evidence = AxisResult["evidence"][number];
export type TargetResult = MatchTargetResult;
export type ConstraintResult = MatchConstraintResult;
export type ConstraintKind = ConstraintResult["kind"];
export type ConstraintStatus = ConstraintResult["status"];
export type ConstraintReason = NonNullable<ConstraintResult["reason"]>;
export type MatchReportView = MatchReport;

export const axisNames: Record<AxisKey, string> = axisDisplayNames;

export const axisStatusLabels: Record<AxisStatus, string> =
  axisStatusDisplayLabels;

export const constraintLabels: Record<ConstraintKind, string> = {
  min_salary: "最低年収",
  location: "勤務地",
  full_remote: "フルリモート必須",
};

export const constraintStatusLabels: Record<ConstraintStatus, string> = {
  met: "満たす",
  unmet: "満たさない",
  unknown: "不明",
  not_required: "条件なし",
};

export const constraintReasonLabels: Record<ConstraintReason, string> = {
  missing_information: "求人情報に記載なし",
  conflicting_information: "記載が矛盾",
  stale_information: "情報が古い",
  salary_unit_mismatch: "給与の単位が異なる",
  salary_range_overlaps_minimum: "給与幅が希望額をまたぐ",
  salary_below_minimum: "希望額を下回る",
  location_outside_allowed: "希望の勤務地外",
  regular_office_attendance_required: "定期的な出社あり",
};

export type TargetSummary = {
  close: number;
  different: number;
  unknown: number;
  excluded: number;
};

/** unknown / conflicting / stale are all "not yet known", never a mismatch. */
export function summarizeTarget(target: TargetResult): TargetSummary | null {
  if (target.status === "incompatible") return null;
  const summary = { close: 0, different: 0, unknown: 0, excluded: 0 };
  for (const axis of target.axes) {
    if (axis.status === "close") summary.close += 1;
    else if (axis.status === "different") summary.different += 1;
    else if (axis.status === "excluded") summary.excluded += 1;
    else summary.unknown += 1;
  }
  return summary;
}

/** Compared axes first, then by the user's importance; ties keep catalog order. */
export function orderAxes(axes: readonly AxisResult[]): AxisResult[] {
  return axes
    .map((axis, index) => ({ axis, index }))
    .sort((left, right) => {
      const excluded =
        Number(left.axis.status === "excluded") -
        Number(right.axis.status === "excluded");
      if (excluded !== 0) return excluded;
      const importance = right.axis.importance - left.axis.importance;
      return importance !== 0 ? importance : left.index - right.index;
    })
    .map(({ axis }) => axis);
}

/** Only http(s) sources become links; anything else is shown as text. */
export function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
