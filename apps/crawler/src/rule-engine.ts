import type {
  AxisDecision,
  DecisionEngineInput,
  EvidenceCandidate,
} from "./decision-engine.js";

export const RULE_ENGINE_VERSION = "public-rules-v1";

function valuesFor(candidate: EvidenceCandidate): (0 | 50 | 100)[] {
  const text = candidate.excerpt;
  if (candidate.axisKey === "schedule_flexibility") {
    const fixed = /フレックスなし|固定勤務時間|勤務時間固定/u.test(text);
    const full = /フルフレックス|コアタイムなし/u.test(text);
    const partial = /フレックスタイム制|コアタイムあり/u.test(text);
    return [
      ...(fixed ? [0 as const] : []),
      ...(full ? [100 as const] : []),
      ...(partial && !full ? [50 as const] : []),
    ];
  }
  if (candidate.axisKey === "work_location") {
    const onsite = /出社必須|原則出社/u.test(text);
    const remote =
      /フルリモート(?:可|可能|勤務|制度)|完全在宅(?:可|可能|勤務)|出社不要/u.test(
        text,
      );
    const officeDays = [
      ...text.matchAll(/週\s*([0-5])\s*日出社(?=$|[。．、，\s])/gu),
    ].map((match) => Number(match[1]));
    return [
      ...(onsite ? [0 as const] : []),
      ...(remote ? [100 as const] : []),
      ...officeDays.map((days): 0 | 50 | 100 =>
        days === 0 ? 100 : days === 5 ? 0 : 50,
      ),
    ];
  }
  return [];
}

export function ruleDecisions(input: DecisionEngineInput): AxisDecision[] {
  return input.rubrics.flatMap((rubric): AxisDecision[] => {
    const matching = input.candidates.filter(
      (candidate) => candidate.axisKey === rubric.axisKey,
    );
    const classified = matching.flatMap((candidate) =>
      valuesFor(candidate).map((value) => ({ candidate, value })),
    );
    if (classified.length === 0) return [];
    const evidenceIds = [
      ...new Set(classified.map(({ candidate }) => candidate.id)),
    ];
    const anchors = new Set(classified.map(({ value }) => value));
    return anchors.size === 1
      ? [
          {
            axisKey: rubric.axisKey,
            status: "known",
            anchorValue: classified[0]!.value,
            evidenceIds,
          },
        ]
      : [
          {
            axisKey: rubric.axisKey,
            status: "conflicting",
            anchorValue: null,
            evidenceIds,
          },
        ];
  });
}
