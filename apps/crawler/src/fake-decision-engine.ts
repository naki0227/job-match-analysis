import {
  decisionsFromEvidence,
  validateDecisionInput,
  type DecisionEngine,
} from "./decision-engine.js";

export function createFakeDecisionEngine(
  accepted: ReadonlyMap<string, 0 | 50 | 100> = new Map(),
): DecisionEngine {
  return {
    async evaluate(input) {
      validateDecisionInput(input);
      return {
        axisCatalogVersion: input.axisCatalogVersion,
        rubricVersion: input.rubricVersion,
        evaluatorVersion: "fake-choice-v1",
        modelVersion: "fake",
        decisions: decisionsFromEvidence(input, accepted),
      };
    },
  };
}
