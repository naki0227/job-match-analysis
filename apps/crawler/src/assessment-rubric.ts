import type { AxisRubric } from "./decision-engine.js";

export const AXIS_CATALOG_VERSION = 1;
export const PUBLIC_RUBRIC_VERSION = "public-anchors-v2";

export const PUBLIC_AXIS_RUBRICS: readonly AxisRubric[] = Object.freeze([
  {
    axisKey: "work_location",
    anchors: {
      0: "原則として出社中心で働く",
      50: "出社と在宅を併用して働く",
      100: "出社不要のフルリモートで働ける",
    },
  },
  {
    axisKey: "autonomy",
    anchors: {
      0: "手順や承認経路に沿って進める仕事が中心",
      50: "担当範囲の設計・実装方法や進め方を一部自分で判断できる",
      100: "方針・優先順位・仕事の進め方を自ら決める裁量が大きい",
    },
  },
  {
    axisKey: "collaboration",
    anchors: {
      0: "個人作業が中心",
      50: "個人作業とチームでの共同作業の両方がある",
      100: "日常的にチームで協働して仕事を進める",
    },
  },
  {
    axisKey: "growth_direction",
    anchors: {
      0: "現在の専門分野を深めることが中心",
      50: "現在の専門性を使いながら新しい技術や隣接領域にも取り組む",
      100: "新しい領域の開拓や未経験領域への挑戦が中心",
    },
  },
  {
    axisKey: "work_change",
    anchors: {
      0: "定型的で予測可能な仕事が中心",
      50: "案件や課題に応じて仕事内容・進め方に一定の変化がある",
      100: "要件や優先順位が頻繁に変わる変化の速い仕事",
    },
  },
  {
    axisKey: "schedule_flexibility",
    anchors: {
      0: "勤務時間が固定されている",
      50: "時差勤務や一部フレックスなど勤務時間を一部調整できる",
      100: "コアタイムなし・裁量労働など勤務時間を広く自分で調整できる",
    },
  },
  {
    axisKey: "role_breadth",
    anchors: {
      0: "一つの専門領域に集中して担当する",
      50: "主な専門業務に加えて隣接する業務も一部担当する",
      100: "企画・設計・開発・テスト・運用・顧客支援など複数の工程や機能を横断して担当する",
    },
  },
  {
    axisKey: "customer_contact",
    anchors: {
      0: "顧客や利用者との直接の接点がほとんどない",
      50: "必要時やときどき顧客・利用者と直接関わる",
      100: "日常的・継続的に顧客や利用者と直接関わる",
    },
  },
]);
