/**
 * A piece of the public source text that the evaluator may read and cite.
 * `text` is an exact substring of the extracted document, so stored evidence
 * can always be found again at `locator`.
 */
export type ContextFragment = {
  id: string;
  scope: "company" | "job";
  documentIndex: number;
  text: string;
  locator: string;
  /** Heading or row label the text sits under, as written on the page. */
  section?: string;
};

export type AxisRubric = {
  axisKey: string;
  anchors: { 0: string; 50: string; 100: string };
};

export type DecisionEngineInput = {
  axisCatalogVersion: number;
  rubricVersion: string;
  scope: "company" | "job";
  rubrics: readonly AxisRubric[];
  fragments: readonly ContextFragment[];
};

export type AxisDecision =
  | {
      axisKey: string;
      status: "known";
      anchorValue: 0 | 50 | 100;
      evidenceIds: readonly string[];
    }
  | {
      axisKey: string;
      status: "unknown" | "conflicting";
      anchorValue: null;
      evidenceIds: readonly string[];
    };

export type DecisionEngineOutput = {
  axisCatalogVersion: number;
  rubricVersion: string;
  evaluatorVersion: string;
  modelVersion: string;
  decisions: readonly AxisDecision[];
};

export interface DecisionEngine {
  evaluate(input: DecisionEngineInput): Promise<DecisionEngineOutput>;
}

export class DecisionEngineInputError extends Error {
  constructor() {
    super("Invalid DecisionEngine input");
    this.name = "DecisionEngineInputError";
  }
}

export class DecisionEngineTransientError extends Error {
  constructor() {
    super("DecisionEngine is temporarily unavailable");
    this.name = "DecisionEngineTransientError";
  }
}

export class DecisionEngineProviderError extends Error {
  constructor() {
    super("DecisionEngine provider returned an invalid result");
    this.name = "DecisionEngineProviderError";
  }
}

export function validateDecisionInput(input: DecisionEngineInput): void {
  if (
    !Number.isInteger(input.axisCatalogVersion) ||
    input.axisCatalogVersion <= 0 ||
    !input.rubricVersion.trim() ||
    input.rubrics.length === 0 ||
    new Set(input.rubrics.map((item) => item.axisKey)).size !==
      input.rubrics.length ||
    new Set(input.fragments.map((item) => item.id)).size !==
      input.fragments.length
  ) {
    throw new DecisionEngineInputError();
  }
  for (const rubric of input.rubrics) {
    if (
      !rubric.axisKey.trim() ||
      !rubric.anchors[0].trim() ||
      !rubric.anchors[50].trim() ||
      !rubric.anchors[100].trim()
    ) {
      throw new DecisionEngineInputError();
    }
  }
  for (const fragment of input.fragments) {
    if (
      !fragment.id.trim() ||
      fragment.scope !== input.scope ||
      !Number.isInteger(fragment.documentIndex) ||
      fragment.documentIndex < 0 ||
      !fragment.text.trim() ||
      !fragment.locator.trim()
    ) {
      throw new DecisionEngineInputError();
    }
  }
}

export function unknownDecisions(input: DecisionEngineInput): AxisDecision[] {
  return input.rubrics.map((rubric) => ({
    axisKey: rubric.axisKey,
    status: "unknown",
    anchorValue: null,
    evidenceIds: [],
  }));
}
