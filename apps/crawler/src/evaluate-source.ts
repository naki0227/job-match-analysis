import {
  AXIS_CATALOG_VERSION,
  PUBLIC_AXIS_RUBRICS,
  PUBLIC_RUBRIC_VERSION,
} from "./assessment-rubric.js";
import type { DecisionEngine } from "./decision-engine.js";
import { unknownDecisions } from "./decision-engine.js";
import {
  DETERMINISTIC_PARSER_VERSION,
  parseDeterministicJobFacts,
} from "./deterministic-parser.js";
import { buildEvaluationPayload } from "./evaluation-payload.js";
import { selectEvidenceCandidates } from "./evidence-candidates.js";
import { RULE_ENGINE_VERSION, ruleDecisions } from "./rule-engine.js";
import type { ExtractedSourceDocument } from "./source-extractor.js";

export async function evaluateSource(args: {
  sourceUrlId: string;
  document: ExtractedSourceDocument;
  scope: "company" | "job";
  engine: DecisionEngine;
  maxCandidates: number;
  maxExcerptChars: number;
}) {
  const documents = [args.document];
  const input = {
    axisCatalogVersion: AXIS_CATALOG_VERSION,
    rubricVersion: PUBLIC_RUBRIC_VERSION,
    scope: args.scope,
    rubrics: PUBLIC_AXIS_RUBRICS,
    candidates: selectEvidenceCandidates({
      documents,
      scope: args.scope,
      rubrics: PUBLIC_AXIS_RUBRICS,
      maxCandidates: args.maxCandidates,
      maxExcerptChars: args.maxExcerptChars,
    }),
  };
  const facts =
    args.scope === "job"
      ? parseDeterministicJobFacts(args.document)
      : undefined;
  const rule = ruleDecisions(input);
  const resolved = new Set(rule.map((decision) => decision.axisKey));
  const fallback = {
    ...input,
    rubrics: input.rubrics.filter((rubric) => !resolved.has(rubric.axisKey)),
    candidates: input.candidates.filter(
      (candidate) => !resolved.has(candidate.axisKey),
    ),
  };
  const engineOutput = fallback.candidates.length
    ? await args.engine.evaluate(fallback)
    : {
        axisCatalogVersion: input.axisCatalogVersion,
        rubricVersion: input.rubricVersion,
        evaluatorVersion: "not-called",
        modelVersion: "not-called",
        decisions: unknownDecisions(fallback),
      };
  // Budget exhaustion also returns "not-called"; those axes are not Jev results.
  const jevCalled = engineOutput.modelVersion !== "not-called";
  const decisions = new Map([
    ...rule.map((decision) => [decision.axisKey, decision] as const),
    ...engineOutput.decisions.map(
      (decision) => [decision.axisKey, decision] as const,
    ),
  ]);
  const output = {
    ...engineOutput,
    evaluatorVersion: `${DETERMINISTIC_PARSER_VERSION}+${RULE_ENGINE_VERSION}+${engineOutput.evaluatorVersion}`,
    decisions: input.rubrics.map((rubric) => decisions.get(rubric.axisKey)!),
  };
  return buildEvaluationPayload({
    sourceUrlIds: [args.sourceUrlId],
    documents,
    input,
    output,
    methods: new Map(
      input.rubrics.map(
        (rubric) =>
          [
            rubric.axisKey,
            resolved.has(rubric.axisKey)
              ? "rule"
              : jevCalled &&
                  fallback.candidates.some(
                    (item) => item.axisKey === rubric.axisKey,
                  )
                ? "jev"
                : "deterministic",
          ] as const,
      ),
    ),
    facts,
  });
}
