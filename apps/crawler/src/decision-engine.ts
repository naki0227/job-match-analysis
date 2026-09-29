export type EvidenceCandidate = {
  id: string;
  axisKey: string;
  scope: "company" | "job";
  documentIndex: number;
  excerpt: string;
  locator: string;
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
  candidates: readonly EvidenceCandidate[];
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
    new Set(input.candidates.map((item) => item.id)).size !==
      input.candidates.length
  ) {
    throw new DecisionEngineInputError();
  }
  const axes = new Set(input.rubrics.map((item) => item.axisKey));
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
  for (const candidate of input.candidates) {
    if (
      !candidate.id.trim() ||
      !axes.has(candidate.axisKey) ||
      candidate.scope !== input.scope ||
      !Number.isInteger(candidate.documentIndex) ||
      candidate.documentIndex < 0 ||
      !candidate.excerpt.trim() ||
      !candidate.locator.trim()
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

export function decisionsFromEvidence(
  input: DecisionEngineInput,
  accepted: ReadonlyMap<string, 0 | 50 | 100>,
): AxisDecision[] {
  return input.rubrics.map((rubric): AxisDecision => {
    const evidence = input.candidates.filter(
      (candidate) =>
        candidate.axisKey === rubric.axisKey && accepted.has(candidate.id),
    );
    const values = new Set(
      evidence.flatMap((candidate) => {
        const value = accepted.get(candidate.id);
        return value === undefined ? [] : [value];
      }),
    );
    if (values.size === 0) {
      return {
        axisKey: rubric.axisKey,
        status: "unknown",
        anchorValue: null,
        evidenceIds: [],
      };
    }
    if (values.size > 1) {
      return {
        axisKey: rubric.axisKey,
        status: "conflicting",
        anchorValue: null,
        evidenceIds: evidence.map((candidate) => candidate.id),
      };
    }
    const value = values.values().next().value;
    if (value === undefined) throw new DecisionEngineProviderError();
    return {
      axisKey: rubric.axisKey,
      status: "known",
      anchorValue: value,
      evidenceIds: evidence.map((candidate) => candidate.id),
    };
  });
}
