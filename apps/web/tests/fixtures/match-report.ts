import type {
  AxisResult,
  MatchReportView,
} from "../../src/features/result/match-report";

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
