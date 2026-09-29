import type { HistoryItem } from "../../src/features/history/history-model";

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
