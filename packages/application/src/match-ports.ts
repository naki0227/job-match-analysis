import type {
  CareerProfileResponse,
  MatchEvidence,
} from "@job-match/contracts";
import type {
  AxisComparison,
  AxisEvidence,
  AxisKey,
  ConstraintResult,
  JobConditions,
} from "@job-match/domain";

/** One shared evaluation with the public evidence that supports its axes. */
export type EvaluationSnapshot = Readonly<{
  evaluationId: string;
  evaluatedAt: string;
  axisCatalogVersion: number;
  axisValues: readonly AxisEvidence[];
  evidence: readonly (MatchEvidence & { axisKey: AxisKey })[];
}>;

/** The requested evaluation plus the latest company-wide evaluation. */
export type MatchEvaluationSource = Readonly<{
  targetType: "job" | "company";
  companyName: string;
  jobTitle: string | null;
  evaluation: EvaluationSnapshot;
  jobConditions?: JobConditions;
  companyEvaluation: EvaluationSnapshot | null;
}>;

export type CommitMatchInput = Readonly<{
  userId: string;
  profileVersionId: string;
  evaluationId: string;
  algorithmVersion: string;
  axes: readonly AxisComparison[];
  constraints: readonly ConstraintResult[];
}>;

export type CommittedMatch = Readonly<{
  matchResultId: string;
  createdAt: string;
  created: boolean;
}>;

/** A stored personal match; axis rows are the snapshot taken at match time. */
export type StoredMatch = Readonly<{
  matchResultId: string;
  createdAt: string;
  algorithmVersion: string;
  evaluationId: string;
  profileVersion: number;
  axisCatalogVersion: number;
  axes: readonly AxisComparison[];
  constraints: readonly ConstraintResult[];
}>;

export type MatchPorts = Readonly<{
  /** The caller's latest completed profile, already bound to that user. */
  latestProfile: () => Promise<CareerProfileResponse | null>;
  readEvaluation: (
    evaluationId: string,
  ) => Promise<MatchEvaluationSource | null>;
  commitMatch: (input: CommitMatchInput) => Promise<CommittedMatch>;
  readMatch: (
    userId: string,
    matchResultId: string,
  ) => Promise<StoredMatch | null>;
}>;
