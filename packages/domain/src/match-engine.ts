import {
  createCareerProfileVersion,
  type CareerProfileVersion,
} from "./career-profile.js";
import {
  evaluateHardConstraints,
  type ConstraintResult,
  type JobConditions,
} from "./hard-constraints.js";
import {
  compareTarget,
  type TargetComparison,
  type TargetEvaluation,
} from "./match-axis.js";

export type JobEvaluation = TargetEvaluation & JobConditions;

export type MatchInput = Readonly<{
  profile: CareerProfileVersion;
  job: JobEvaluation;
  company?: TargetEvaluation;
}>;

export type MatchResult = Readonly<{
  job: TargetComparison;
  company?: TargetComparison;
  hardConstraints: readonly ConstraintResult[];
  hasHardConflict: boolean;
}>;

/** Pure comparison; company facts never fill missing job evidence. */
export function matchCareerProfile(input: MatchInput): MatchResult {
  const profile = createCareerProfileVersion(input.profile);
  const job = compareTarget(profile, input.job, "job");
  const company =
    input.company === undefined
      ? undefined
      : compareTarget(profile, input.company, "company");
  const hardConstraints = evaluateHardConstraints(
    profile.constraints,
    input.job,
  );

  return Object.freeze({
    job,
    ...(company === undefined ? {} : { company }),
    hardConstraints,
    hasHardConflict: hardConstraints.some((entry) => entry.status === "unmet"),
  });
}
