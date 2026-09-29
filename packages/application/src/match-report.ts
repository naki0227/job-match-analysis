import type {
  MatchAxisResult,
  MatchReport,
  MatchTargetResult,
} from "@job-match/contracts";
import type {
  AxisComparison,
  ConstraintResult,
  TargetComparison,
} from "@job-match/domain";
import type {
  EvaluationSnapshot,
  MatchEvaluationSource,
} from "./match-ports.js";

function observedAnchor(axis: AxisComparison): 0 | 50 | 100 | null {
  const observation = axis.observation;
  return observation.status === "known" || observation.status === "stale"
    ? observation.value
    : null;
}

function toAxisResult(
  axis: AxisComparison,
  snapshot: EvaluationSnapshot,
): MatchAxisResult {
  return {
    axisKey: axis.axisKey,
    status: axis.status,
    preference: axis.preference,
    importance: axis.importance,
    observed: observedAnchor(axis),
    evidence: snapshot.evidence
      .filter((item) => item.axisKey === axis.axisKey)
      .map(({ quote, sourceUrl, fetchedAt }) => ({
        quote,
        sourceUrl,
        fetchedAt,
      })),
  };
}

export function toTargetResult(
  comparison: TargetComparison,
  snapshot: EvaluationSnapshot,
): MatchTargetResult {
  const common = {
    evaluationId: snapshot.evaluationId,
    evaluatedAt: snapshot.evaluatedAt,
  };
  if (comparison.status === "incompatible") {
    return { status: "incompatible", ...common };
  }
  return {
    status: "comparable",
    ...common,
    axes: comparison.axes.map((axis) => toAxisResult(axis, snapshot)),
  };
}

export type ReportInput = Readonly<{
  matchResultId: string;
  createdAt: string;
  algorithmVersion: string;
  profileVersion: number;
  source: MatchEvaluationSource;
  job: TargetComparison;
  company: TargetComparison | null;
  constraints: readonly ConstraintResult[];
}>;

export function buildMatchReport(input: ReportInput): MatchReport {
  const { source } = input;
  return {
    matchResultId: input.matchResultId,
    createdAt: input.createdAt,
    profileVersion: input.profileVersion,
    algorithmVersion: input.algorithmVersion,
    companyName: source.companyName,
    jobTitle: source.jobTitle ?? "",
    job: toTargetResult(input.job, source.evaluation),
    company:
      input.company && source.companyEvaluation
        ? toTargetResult(input.company, source.companyEvaluation)
        : null,
    hardConstraints: input.constraints.map((constraint) => ({
      kind: constraint.kind,
      status: constraint.status,
      ...(constraint.reason === undefined ? {} : { reason: constraint.reason }),
    })),
  };
}
