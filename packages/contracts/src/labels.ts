import type { careerAxisKeys } from "./career-profile.js";
import type { matchAxisStatuses } from "./matches.js";

type AxisKey = (typeof careerAxisKeys)[number];
type AxisStatus = (typeof matchAxisStatuses)[number];

/** Japanese display names shared by the SPA and server-rendered share pages. */
export const axisDisplayNames: Readonly<Record<AxisKey, string>> = {
  work_location: "働く場所",
  autonomy: "裁量",
  collaboration: "協働",
  growth_direction: "成長の方向",
  work_change: "仕事の変化",
  schedule_flexibility: "勤務時間の柔軟性",
  role_breadth: "役割の幅",
  customer_contact: "顧客との接点",
};

/** Words for per-axis judgements; none of them is a number or a score. */
export const axisStatusDisplayLabels: Readonly<Record<AxisStatus, string>> = {
  close: "近い",
  different: "相違",
  partial: "一部近い",
  unknown: "不明",
  conflicting: "情報が矛盾",
  stale: "情報が古い",
  excluded: "比較対象外",
};
