/**
 * Sample data for the dev-only UI preview and for tests. Company names are
 * fictional samples; nothing here is shown in the production app.
 */
import {
  careerAxisKeys,
  type CareerProfileResponse,
} from "@job-match/contracts";
import type { HistoryItem } from "../features/history/history-model";
import type {
  AxisResult,
  MatchReportView,
} from "../features/result/match-report";

const jobUrl = "https://jobs.example.com/sample-tech/backend";
const fetchedAt = "2026-09-20T01:02:03.000Z";
export const jobEvaluationId = "3f0c7c1e-8d2b-4a52-9c36-2f7f2f0c9a11";
const companyEvaluationId = "0c1e9a11-8d2b-4a52-9c36-2f7f2f0c3f7f";

export const jobAxes: AxisResult[] = [
  {
    axisKey: "work_location",
    status: "different",
    preference: 95,
    importance: 60,
    observed: 50,
    evidence: [
      { quote: "週3日はオフィスで勤務します。", sourceUrl: jobUrl, fetchedAt },
    ],
  },
  {
    axisKey: "autonomy",
    status: "close",
    preference: 82,
    importance: 90,
    observed: 100,
    evidence: [
      { quote: "設計・技術選定にも参加します。", sourceUrl: jobUrl, fetchedAt },
    ],
  },
  {
    axisKey: "customer_contact",
    status: "unknown",
    preference: 40,
    importance: 70,
    observed: null,
    evidence: [],
  },
  {
    axisKey: "work_change",
    status: "excluded",
    preference: 50,
    importance: 0,
    observed: null,
    evidence: [],
  },
  {
    axisKey: "role_breadth",
    status: "stale",
    preference: 70,
    importance: 30,
    observed: null,
    evidence: [],
  },
];

/** Axes without evidence, so the fixtures carry all eight axes. */
function unknownAxes(keys: AxisResult["axisKey"][]): AxisResult[] {
  return keys.map((axisKey) => ({
    axisKey,
    status: "unknown",
    preference: 50,
    importance: 20,
    observed: null,
    evidence: [],
  }));
}

export const sampleReport: MatchReportView = {
  matchResultId: "8a4d1c2e-51c1-4f4e-9f7e-6c3a1b2d4e5f",
  createdAt: "2026-09-29T00:00:00.000Z",
  profileVersion: 2,
  algorithmVersion: "match-engine-v1",
  companyName: "サンプルテック株式会社",
  jobTitle: "Backend Engineer",
  job: {
    status: "comparable",
    evaluationId: jobEvaluationId,
    evaluatedAt: fetchedAt,
    axes: [
      ...jobAxes,
      ...unknownAxes([
        "collaboration",
        "growth_direction",
        "schedule_flexibility",
      ]),
    ],
  },
  company: {
    status: "comparable",
    evaluationId: companyEvaluationId,
    evaluatedAt: fetchedAt,
    axes: [
      {
        axisKey: "schedule_flexibility",
        status: "close",
        preference: 90,
        importance: 50,
        observed: 100,
        evidence: [
          {
            quote: "全社でコアタイムのないフレックス制度を導入しています。",
            sourceUrl: "https://sample-tech.example.com/careers",
            fetchedAt,
          },
        ],
      },
      ...unknownAxes([
        "work_location",
        "autonomy",
        "collaboration",
        "growth_direction",
        "work_change",
        "role_breadth",
        "customer_contact",
      ]),
    ],
  },
  hardConstraints: [
    { kind: "min_salary", status: "met" },
    { kind: "location", status: "unknown", reason: "missing_information" },
    {
      kind: "full_remote",
      status: "unmet",
      reason: "regular_office_attendance_required",
    },
  ],
};

export const historyItems: HistoryItem[] = [
  {
    matchResultId: "11111111-1111-4111-8111-111111111111",
    companyName: "サンプルテック株式会社",
    jobTitle: "Backend Engineer",
    analyzedAt: "2026-09-28T01:00:00.000Z",
    profileVersion: 2,
    summary: { close: 5, different: 1, unknown: 2 },
    staleConditions: false,
  },
  {
    matchResultId: "22222222-2222-4222-8222-222222222222",
    companyName: "サンプルラボ株式会社",
    jobTitle: "Frontend Engineer",
    analyzedAt: "2026-09-29T01:00:00.000Z",
    profileVersion: 2,
    summary: { close: 2, different: 4, unknown: 2 },
    staleConditions: true,
  },
  {
    matchResultId: "33333333-3333-4333-8333-333333333333",
    companyName: "サンプルクラウド株式会社",
    jobTitle: "Backend Engineer",
    analyzedAt: "2026-09-20T01:00:00.000Z",
    profileVersion: 1,
    summary: { close: 6, different: 0, unknown: 0 },
    staleConditions: false,
  },
];

/** A saved career profile for previews; values are illustrative only. */
export const sampleProfile: CareerProfileResponse = {
  profileVersionId: "b5e4309c-5947-4d75-a47d-94b34187ad20",
  profileVersion: 2,
  profile: {
    axisCatalogVersion: 1,
    targetRoles: ["Backend Engineer"],
    axisValues: careerAxisKeys.map((axisKey, index) => ({
      axisKey,
      axisVersion: 1,
      preference: [95, 82, 60, 70, 50, 90, 70, 40][index] ?? 50,
      importance: axisKey === "work_change" ? 0 : 60,
    })),
    constraints: {
      minSalary: { amount: 5_000_000, currency: "JPY", period: "year" },
      allowedPrefectureCodes: ["13", "27"],
      fullRemoteRequired: false,
    },
  },
};
