import type { AxisRubric } from "./decision-engine.js";

export const AXIS_CATALOG_VERSION = 1;
export const PUBLIC_RUBRIC_VERSION = "public-anchors-v1";

export const PUBLIC_AXIS_RUBRICS: readonly AxisRubric[] = Object.freeze([
  {
    axisKey: "work_location",
    anchors: {
      0: "出社が前提と明示されている",
      50: "出社と在宅の併用条件が明示されている",
      100: "出社不要のフルリモートが明示されている",
    },
  },
  {
    axisKey: "autonomy",
    anchors: {
      0: "手順や承認経路が定められている",
      50: "担当範囲で手順の一部を自分で選べる",
      100: "方針や仕事の進め方を自ら決める権限がある",
    },
  },
  {
    axisKey: "collaboration",
    anchors: {
      0: "個人で仕事を完結する役割が明示されている",
      50: "個人作業と共同作業の両方が明示されている",
      100: "チームで共同責任を持つ仕事が明示されている",
    },
  },
  {
    axisKey: "growth_direction",
    anchors: {
      0: "特定の専門分野を深める職務が明示されている",
      50: "専門業務と新しい領域の両方を担う",
      100: "新しい領域を開拓する職務が明示されている",
    },
  },
  {
    axisKey: "work_change",
    anchors: {
      0: "定型的で予測可能な職務が明示されている",
      50: "定型業務と変化する案件の両方が明示されている",
      100: "仕事の優先順位が頻繁に変わると明示されている",
    },
  },
  {
    axisKey: "schedule_flexibility",
    anchors: {
      0: "勤務時間が固定されている",
      50: "時差勤務または一部のフレックスが明示されている",
      100: "コアタイムなしなど広い時間裁量が明示されている",
    },
  },
  {
    axisKey: "role_breadth",
    anchors: {
      0: "担当する領域が一つの専門分野に限定されている",
      50: "専門業務に加えて別の領域を一部兼務する",
      100: "複数の領域を横断して担当する",
    },
  },
  {
    axisKey: "customer_contact",
    anchors: {
      0: "顧客や利用者との直接の接点がない",
      50: "顧客や利用者と定期的に接する",
      100: "日常的に顧客や利用者と共同作業する",
    },
  },
]);
