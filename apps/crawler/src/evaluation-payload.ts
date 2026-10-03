import {
  validateDecisionInput,
  type DecisionEngineInput,
  type DecisionEngineOutput,
} from "./decision-engine.js";
import { sourceSetHash } from "./evaluation-input.js";
import type { ParsedJobFacts } from "./deterministic-parser.js";
import type { JobSections } from "./job-sections.js";
import {
  evaluationDocumentPayload,
  type ExtractedSourceDocument,
} from "./source-extractor.js";

export class EvaluationPayloadError extends Error {
  constructor() {
    super("Evaluation result does not match its source input");
    this.name = "EvaluationPayloadError";
  }
}

export function buildEvaluationPayload(args: {
  sourceUrlIds: readonly string[];
  documents: readonly ExtractedSourceDocument[];
  input: DecisionEngineInput;
  output: DecisionEngineOutput;
  methods?: ReadonlyMap<string, "deterministic" | "rule" | "jev">;
  facts?: ParsedJobFacts & JobSections;
}) {
  const { sourceUrlIds, documents, input, output } = args;
  validateDecisionInput(input);
  if (
    documents.length === 0 ||
    documents.length !== sourceUrlIds.length ||
    sourceUrlIds.some((id) => !id) ||
    output.axisCatalogVersion !== input.axisCatalogVersion ||
    output.rubricVersion !== input.rubricVersion ||
    !output.evaluatorVersion.trim() ||
    !output.modelVersion.trim() ||
    output.decisions.length !== input.rubrics.length
  ) {
    throw new EvaluationPayloadError();
  }
  const fragments = new Map(input.fragments.map((item) => [item.id, item]));
  const decisions = new Map(
    output.decisions.map((item) => [item.axisKey, item]),
  );
  if (decisions.size !== input.rubrics.length)
    throw new EvaluationPayloadError();
  const axisValues = [];
  const evidence = [];
  for (const rubric of input.rubrics) {
    const decision = decisions.get(rubric.axisKey);
    if (!decision) throw new EvaluationPayloadError();
    if (
      (decision.status === "known" &&
        (decision.evidenceIds.length === 0 ||
          ![0, 50, 100].includes(decision.anchorValue))) ||
      (decision.status === "range" &&
        (decision.evidenceIds.length === 0 ||
          ![0, 50].includes(decision.anchorValue) ||
          decision.anchorMax !== decision.anchorValue + 50)) ||
      (decision.status !== "known" &&
        decision.status !== "range" &&
        decision.anchorValue !== null)
    ) {
      throw new EvaluationPayloadError();
    }
    axisValues.push({
      axisKey: rubric.axisKey,
      axisVersion: input.axisCatalogVersion,
      observationStatus: decision.status,
      anchorValue: decision.anchorValue,
      anchorMax: decision.status === "range" ? decision.anchorMax : null,
      evaluationMethod: args.methods?.get(rubric.axisKey) ?? "jev",
    });
    // One axis may cite several fragments; each is stored once.
    for (const id of new Set(decision.evidenceIds)) {
      const fragment = fragments.get(id);
      if (!fragment) throw new EvaluationPayloadError();
      evidence.push({
        documentIndex: fragment.documentIndex,
        axisKey: rubric.axisKey,
        excerpt: fragment.text,
        locator: fragment.locator,
      });
    }
  }
  const hash = sourceSetHash({
    documents,
    fragments: input.fragments,
    scope: input.scope,
  });
  return {
    documents: documents.map((document, index) =>
      evaluationDocumentPayload(sourceUrlIds[index]!, document),
    ),
    evaluation: {
      axisCatalogVersion: input.axisCatalogVersion,
      sourceSetHash: hash,
      rubricVersion: input.rubricVersion,
      evaluatorVersion: output.evaluatorVersion,
      modelVersion: output.modelVersion,
      axisValues,
      evidence,
      jobFacts: args.facts ?? null,
    },
  };
}
