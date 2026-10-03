import {
  DecisionEngineInputError,
  DecisionEngineProviderError,
  DecisionEngineTransientError,
  unknownDecisions,
  validateDecisionInput,
  type DecisionEngine,
} from "../../decision-engine.js";
import {
  noopCrawlerMetrics,
  type CrawlerMetrics,
} from "../../crawler-metrics.js";
import { CONTEXT_SELECTOR_VERSION } from "../../context-fragments.js";
import { callJev, type JevRequest, type JevResponse } from "./client.js";
import {
  buildJudgementRequest,
  decisionsFromJudgement,
  locatedFromJudgement,
} from "./context-judgement.js";
import {
  JevApiError,
  JevNetworkError,
  JevRateLimitError,
  JevTimeoutError,
} from "./error.js";

export const JEV_EVALUATOR_VERSION = `jev-context-v7+${CONTEXT_SELECTOR_VERSION}`;

/** Fragments kept per locate question; a section can span several items. */
const MAX_LOCATED_PER_QUESTION = 8;

/** A whole-context request is larger than the old per-excerpt calls. */
const JEV_TIMEOUT_MS = 30_000;

export function createJevDecisionEngine(args: {
  maxEvidencePerAxis: number;
  call?: (request: JevRequest) => Promise<JevResponse>;
  metrics?: CrawlerMetrics;
}): DecisionEngine {
  if (
    !Number.isSafeInteger(args.maxEvidencePerAxis) ||
    args.maxEvidencePerAxis <= 0
  ) {
    throw new DecisionEngineInputError();
  }
  const call =
    args.call ??
    ((request: JevRequest) => callJev(request, { timeoutMs: JEV_TIMEOUT_MS }));
  const metrics = args.metrics ?? noopCrawlerMetrics;
  return {
    async evaluate(input) {
      validateDecisionInput(input);
      if (input.fragments.length === 0) {
        return {
          axisCatalogVersion: input.axisCatalogVersion,
          rubricVersion: input.rubricVersion,
          evaluatorVersion: JEV_EVALUATOR_VERSION,
          modelVersion: "no-evidence",
          decisions: unknownDecisions(input),
        };
      }
      let response: JevResponse;
      const started = performance.now();
      try {
        response = await call(
          buildJudgementRequest(input.rubrics, input.fragments, input.locate),
        );
      } catch (error) {
        const transient =
          error instanceof JevRateLimitError ||
          error instanceof JevTimeoutError ||
          error instanceof JevNetworkError ||
          (error instanceof JevApiError && error.status >= 500);
        metrics.jevCall({
          fragments: input.fragments.length,
          axes: input.rubrics.length,
          inputTokens: null,
          outputTokens: null,
          outcome: transient ? "transient_error" : "provider_error",
          durationMs: performance.now() - started,
        });
        if (transient) throw new DecisionEngineTransientError();
        throw new DecisionEngineProviderError();
      }
      metrics.jevCall({
        fragments: input.fragments.length,
        axes: input.rubrics.length,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        outcome: "success",
        durationMs: performance.now() - started,
      });
      return {
        axisCatalogVersion: input.axisCatalogVersion,
        rubricVersion: input.rubricVersion,
        evaluatorVersion: JEV_EVALUATOR_VERSION,
        modelVersion: response.model,
        decisions: decisionsFromJudgement(
          input.rubrics,
          input.fragments,
          response,
          args.maxEvidencePerAxis,
        ),
        located: locatedFromJudgement(
          input.locate ?? [],
          input.fragments,
          response,
          MAX_LOCATED_PER_QUESTION,
        ),
      };
    },
  };
}
