import type { careerAxisKeys } from "@job-match/contracts";

/**
 * View model for one personal match. It mirrors the domain MatchResult
 * (docs/matching.md) until the match API contract is defined.
 */
export type AxisKey = (typeof careerAxisKeys)[number];
export type AxisStatus =
  "close" | "different" | "excluded" | "unknown" | "conflicting" | "stale";

export type Evidence = {
  quote: string;
  sourceUrl: string;
  fetchedAt: string;
};

export type AxisResult = {
  axisKey: AxisKey;
  status: AxisStatus;
  preference: number;
  importance: number;
  observed: 0 | 50 | 100 | null;
  evidence: readonly Evidence[];
};

export type TargetResult =
  | { status: "comparable"; axes: readonly AxisResult[] }
  | { status: "incompatible" };

export type ConstraintKind = "min_salary" | "location" | "full_remote";
export type ConstraintStatus = "met" | "unmet" | "unknown" | "not_required";

export type ConstraintResult = {
  kind: ConstraintKind;
  status: ConstraintStatus;
};

export type MatchReportView = {
  companyName: string;
  jobTitle: string;
  job: TargetResult;
  company: TargetResult | null;
  hardConstraints: readonly ConstraintResult[];
};

export const axisNames: Record<AxisKey, string> = {
  work_location: "働く場所",
  autonomy: "裁量",
  collaboration: "協働",
  growth_direction: "成長の方向",
  work_change: "仕事の変化",
  schedule_flexibility: "勤務時間の柔軟性",
  role_breadth: "役割の幅",
  customer_contact: "顧客との接点",
};

export const axisStatusLabels: Record<AxisStatus, string> = {
  close: "近い",
  different: "相違",
  unknown: "不明",
  conflicting: "情報が矛盾",
  stale: "情報が古い",
  excluded: "比較対象外",
};

export const constraintLabels: Record<ConstraintKind, string> = {
  min_salary: "最低年収",
  location: "勤務地",
  full_remote: "フルリモート",
};

export const constraintStatusLabels: Record<ConstraintStatus, string> = {
  met: "満たす",
  unmet: "満たさない",
  unknown: "不明",
  not_required: "条件なし",
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
