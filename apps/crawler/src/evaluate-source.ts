import {
  AXIS_CATALOG_VERSION,
  PUBLIC_AXIS_RUBRICS,
  PUBLIC_RUBRIC_VERSION,
} from "./assessment-rubric.js";
import {
  buildContextFragments,
  type ContextLimits,
} from "./context-fragments.js";
import { noopCrawlerMetrics, type CrawlerMetrics } from "./crawler-metrics.js";
import type { AxisDecision, DecisionEngine } from "./decision-engine.js";
import { unknownDecisions } from "./decision-engine.js";
import {
  DETERMINISTIC_PARSER_VERSION,
  parseDeterministicJobFacts,
} from "./deterministic-parser.js";
import { buildEvaluationPayload } from "./evaluation-payload.js";
import { RULE_ENGINE_VERSION, ruleDecisions } from "./rule-engine.js";
import type { ExtractedSourceDocument } from "./source-extractor.js";

/**
 * Structured facts and explicit rules decide what they can; the evaluator
 * reads the whole bounded context for the remaining axes only.
 */
export async function evaluateSource(args: {
  sourceUrlId: string;
  document: ExtractedSourceDocument;
  scope: "company" | "job";
  engine: DecisionEngine;
  limits: ContextLimits;
  metrics?: CrawlerMetrics;
}) {
  const started = performance.now();
  const metrics = args.metrics ?? noopCrawlerMetrics;
  const documents = [args.document];
  const context = buildContextFragments({
    documents,
    scope: args.scope,
    limits: args.limits,
  });
  const input = {
    axisCatalogVersion: AXIS_CATALOG_VERSION,
    rubricVersion: PUBLIC_RUBRIC_VERSION,
    scope: args.scope,
    rubrics: PUBLIC_AXIS_RUBRICS,
    fragments: context.fragments,
  };
  const facts =
    args.scope === "job"
      ? parseDeterministicJobFacts(args.document)
      : undefined;
  const rule = ruleDecisions(input);
  const resolved = new Set(rule.map((decision) => decision.axisKey));
  const unresolved = {
    ...input,
    rubrics: input.rubrics.filter((rubric) => !resolved.has(rubric.axisKey)),
  };
  const engineOutput =
    unresolved.rubrics.length && unresolved.fragments.length
      ? await args.engine.evaluate(unresolved)
      : {
          axisCatalogVersion: input.axisCatalogVersion,
          rubricVersion: input.rubricVersion,
          evaluatorVersion: "not-called",
          modelVersion: "not-called",
          decisions: unknownDecisions(unresolved),
        };
  // Budget exhaustion also returns "not-called"; those axes are not Jev results.
  const jevCalled =
    engineOutput.modelVersion !== "not-called" &&
    engineOutput.modelVersion !== "no-evidence";
  const decisions = new Map<string, AxisDecision>([
    ...rule.map((decision) => [decision.axisKey, decision] as const),
    ...engineOutput.decisions.map(
      (decision) => [decision.axisKey, decision] as const,
    ),
  ]);
  const ordered = input.rubrics.map((rubric) => decisions.get(rubric.axisKey)!);
  const output = {
    ...engineOutput,
    evaluatorVersion: `${DETERMINISTIC_PARSER_VERSION}+${RULE_ENGINE_VERSION}+${engineOutput.evaluatorVersion}`,
    decisions: ordered,
  };
  const payload = buildEvaluationPayload({
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
              : jevCalled
                ? "jev"
                : "deterministic",
          ] as const,
      ),
    ),
    facts,
  });
  const count = (status: AxisDecision["status"]) =>
    ordered.filter((decision) => decision.status === status).length;
  metrics.evaluation({
    scope: args.scope,
    extractedChars: args.document.extractedText.length,
    fragmentsAvailable: context.stats.available,
    fragmentsSent: context.stats.sent,
    unresolvedAfterRules: unresolved.rubrics.length,
    axesSentToJev: jevCalled ? unresolved.rubrics.length : 0,
    known: count("known"),
    unknown: count("unknown"),
    conflicting: count("conflicting"),
    evidencePerAxis: ordered
      .map((decision) => new Set(decision.evidenceIds).size)
      .filter((size) => size > 0),
    durationMs: performance.now() - started,
  });
  return payload;
}
