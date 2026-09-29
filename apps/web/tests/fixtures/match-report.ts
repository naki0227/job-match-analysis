import type {
  AxisResult,
  MatchReportView,
} from "../../src/features/result/match-report";

const jobUrl = "https://jobs.example.com/sample-tech/backend";
const fetchedAt = "2026-09-20T01:02:03.000Z";

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

export const sampleReport: MatchReportView = {
  companyName: "サンプルテック株式会社",
  jobTitle: "Backend Engineer",
  job: { status: "comparable", axes: jobAxes },
  company: {
    status: "comparable",
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
    ],
  },
  hardConstraints: [
    { kind: "min_salary", status: "met" },
    { kind: "location", status: "unknown" },
    { kind: "full_remote", status: "unmet" },
  ],
};
