import type {
  AxisDecision,
  ContextFragment,
  DecisionEngineInput,
} from "./decision-engine.js";

export const RULE_ENGINE_VERSION = "public-rules-v3";

/** Explicit wording that decides an axis without the evaluator. */
function valuesFor(axisKey: string, text: string): (0 | 50 | 100)[] {
  if (axisKey === "schedule_flexibility") {
    const fixed = /フレックスなし|固定勤務時間|勤務時間固定/u.test(text);
    const full = /フルフレックス|コアタイムなし/u.test(text);
    const partial = /フレックスタイム制|コアタイムあり/u.test(text);
    return [
      ...(fixed ? [0 as const] : []),
      ...(full ? [100 as const] : []),
      ...(partial && !full ? [50 as const] : []),
    ];
  }
  if (axisKey === "work_location") {
    const requiredOfficeDays = [
      ...text.matchAll(/週\s*([0-5])\s*日?\s*(?:の)?\s*出社\s*必須/gu),
    ].map((match) => Number(match[1]));
    const officeDays = requiredOfficeDays.length
      ? requiredOfficeDays
      : [
          ...text.matchAll(
            /週\s*([0-5])\s*日?\s*(?:の)?\s*出社(?=$|[。．、，\s])/gu,
          ),
        ].map((match) => Number(match[1]));
    const onsite =
      officeDays.length === 0 &&
      /出社\s*必須|原則[、,\s]*出社/u.test(text);
    const remote =
      /フルリモート(?:可|可能|勤務|制度)|完全在宅(?:可|可能|勤務)|出社不要/u.test(
        text,
      );
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

/**
 * Decides the axes whose explicit wording is unambiguous. Every matching
 * fragment becomes evidence; disagreeing fragments make the axis conflicting.
 */
export function ruleDecisions(
  input: Pick<DecisionEngineInput, "rubrics"> & {
    fragments: readonly ContextFragment[];
  },
): AxisDecision[] {
  return input.rubrics.flatMap((rubric): AxisDecision[] => {
    const classified = input.fragments.flatMap((fragment) =>
      valuesFor(rubric.axisKey, fragment.text).map((value) => ({
        fragment,
        value,
      })),
    );
    if (classified.length === 0) return [];
    const evidenceIds = [
      ...new Set(classified.map(({ fragment }) => fragment.id)),
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
