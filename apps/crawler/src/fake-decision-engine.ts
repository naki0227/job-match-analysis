import {
  unknownDecisions,
  validateDecisionInput,
  type AxisDecision,
  type DecisionEngine,
  type DecisionEngineInput,
} from "./decision-engine.js";

/** Test double: decides with `decide`, or leaves every axis unknown. */
export function createFakeDecisionEngine(
  decide: (input: DecisionEngineInput) => AxisDecision[] = unknownDecisions,
): DecisionEngine {
  return {
    async evaluate(input) {
      validateDecisionInput(input);
      return {
        axisCatalogVersion: input.axisCatalogVersion,
        rubricVersion: input.rubricVersion,
        evaluatorVersion: "fake-context-v1",
        modelVersion: "fake",
        decisions: decide(input),
      };
    },
  };
}
