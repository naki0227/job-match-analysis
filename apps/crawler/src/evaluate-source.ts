import {
  AXIS_CATALOG_VERSION,
  PUBLIC_AXIS_RUBRICS,
  PUBLIC_RUBRIC_VERSION,
} from "./assessment-rubric.js";
import type { DecisionEngine } from "./decision-engine.js";
import { buildEvaluationPayload } from "./evaluation-payload.js";
import { selectEvidenceCandidates } from "./evidence-candidates.js";
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
  const output = await args.engine.evaluate(input);
  return buildEvaluationPayload({
    sourceUrlIds: [args.sourceUrlId],
    documents,
    input,
    output,
  });
}
