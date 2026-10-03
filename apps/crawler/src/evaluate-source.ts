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
import { readJobSections } from "./job-sections.js";
import { applyLocated, locateQuestions } from "./located-facts.js";
import { RULE_ENGINE_VERSION, ruleDecisions } from "./rule-engine.js";
import type { ExtractedSourceDocument } from "./source-extractor.js";

/**
 * What the posting says comes first: the parser reads job facts and the
 * page's own headings give its sections. Explicit rules decide what axes
 * they can. One evaluator call then reads the complete context for the
 * remaining axes and points at fragments for any fact or section still
 * missing; those values are read from the located text, never generated.
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
  const parsed =
    args.scope === "job"
      ? {
          facts: parseDeterministicJobFacts(args.document),
          sections: readJobSections(context.fragments),
        }
      : undefined;
  const rule = ruleDecisions(input);
  const resolved = new Set(rule.map((decision) => decision.axisKey));
  const locate = parsed ? locateQuestions(parsed.facts, parsed.sections) : [];
  const unresolved = {
    ...input,
    rubrics: input.rubrics.filter((rubric) => !resolved.has(rubric.axisKey)),
    ...(locate.length ? { locate } : {}),
  };
  const engineOutput =
    (unresolved.rubrics.length || locate.length) && unresolved.fragments.length
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
  const understood = parsed
    ? applyLocated({
        ...parsed,
        located: engineOutput.located ?? {},
        fragments: context.fragments,
      })
    : undefined;
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
    facts: understood
      ? { ...understood.facts, ...understood.sections }
      : undefined,
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
    range: count("range"),
    unknown: count("unknown"),
    conflicting: count("conflicting"),
    evidencePerAxis: ordered
      .map((decision) => new Set(decision.evidenceIds).size)
      .filter((size) => size > 0),
    durationMs: performance.now() - started,
  });
  return payload;
}
