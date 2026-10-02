import type { CareerProfileResponse, MatchReport } from "@job-match/contracts";
import {
  compareTarget,
  matchCareerProfile,
  parsePrefectureCode,
  type CareerProfileVersion,
  type JobConditions,
  type JobEvaluation,
  type TargetEvaluation,
} from "@job-match/domain";
import type { MatchPorts, StoredMatch } from "./match-ports.js";
import { buildMatchReport } from "./match-report.js";

export const MATCH_ALGORITHM_VERSION = "match-engine-v2";

export type CreateMatchResult =
  | { status: "created" | "existing"; report: MatchReport }
  | { status: "evaluation_not_found" }
  | { status: "not_job_evaluation" }
  | { status: "profile_missing" }
  | { status: "incompatible" };

export type ReadMatchResult =
  { status: "found"; report: MatchReport } | { status: "not_found" };

/** An empty prefecture list means "not specified" in the API contract. */
export function toCareerProfileVersion(
  response: CareerProfileResponse,
): CareerProfileVersion {
  const { profile } = response;
  const locations = profile.constraints.allowedPrefectureCodes;
  return {
    profileVersion: response.profileVersion,
    axisCatalogVersion: profile.axisCatalogVersion,
    status: "completed",
    targetRoles: profile.targetRoles,
    axisValues: profile.axisValues,
    constraints: {
      ...(profile.constraints.minSalary === undefined
        ? {}
        : { minSalary: profile.constraints.minSalary }),
      ...(locations.length === 0
        ? {}
        : { allowedPrefectureCodes: locations.map(parsePrefectureCode) }),
      fullRemoteRequired: profile.constraints.fullRemoteRequired,
    },
  };
}

function asTarget(snapshot: {
  axisCatalogVersion: number;
  axisValues: TargetEvaluation["axisValues"];
}): TargetEvaluation {
  return {
    axisCatalogVersion: snapshot.axisCatalogVersion,
    axisValues: snapshot.axisValues,
  };
}

function asJob(
  snapshot: {
    axisCatalogVersion: number;
    axisValues: TargetEvaluation["axisValues"];
  },
  conditions: JobConditions,
): JobEvaluation {
  return { ...asTarget(snapshot), ...conditions };
}

/**
 * Compares the caller's latest profile with a job evaluation and stores the
 * result. Re-running with the same inputs returns the stored match.
 */
export async function createMatch(
  ports: MatchPorts,
  input: { userId: string; evaluationId: string },
): Promise<CreateMatchResult> {
  const source = await ports.readEvaluation(input.evaluationId);
  if (!source) return { status: "evaluation_not_found" };
  if (source.targetType !== "job" || source.jobTitle === null) {
    return { status: "not_job_evaluation" };
  }
  const latest = await ports.latestProfile();
  if (!latest) return { status: "profile_missing" };

  const result = matchCareerProfile({
    profile: toCareerProfileVersion(latest),
    job: asJob(source.evaluation, source.jobConditions),
    ...(source.companyEvaluation
      ? { company: asTarget(source.companyEvaluation) }
      : {}),
  });
  if (result.job.status === "incompatible") return { status: "incompatible" };

  const committed = await ports.commitMatch({
    userId: input.userId,
    profileVersionId: latest.profileVersionId,
    evaluationId: input.evaluationId,
    algorithmVersion: MATCH_ALGORITHM_VERSION,
    axes: result.job.axes,
    constraints: result.hardConstraints,
  });
  return {
    status: committed.created ? "created" : "existing",
    report: buildMatchReport({
      matchResultId: committed.matchResultId,
      createdAt: committed.createdAt,
      algorithmVersion: MATCH_ALGORITHM_VERSION,
      profileVersion: latest.profileVersion,
      source,
      job: result.job,
      company: result.company ?? null,
      constraints: result.hardConstraints,
    }),
  };
}

/** compareTarget reads only the catalog version and axis answers. */
function profileFromSnapshot(match: StoredMatch): CareerProfileVersion {
  return {
    profileVersion: match.profileVersion,
    axisCatalogVersion: match.axisCatalogVersion,
    status: "completed",
    targetRoles: [],
    axisValues: match.axes.map((axis) => ({
      axisKey: axis.axisKey,
      axisVersion: match.axisCatalogVersion,
      preference: axis.preference,
      importance: axis.importance,
    })),
    constraints: { fullRemoteRequired: false },
  };
}

/**
 * Reads a stored match of the caller. Job axes come from the stored snapshot;
 * the company part is compared with the latest company evaluation.
 */
export async function readMatch(
  ports: Pick<MatchPorts, "readMatch" | "readEvaluation">,
  input: { userId: string; matchResultId: string },
): Promise<ReadMatchResult> {
  const match = await ports.readMatch(input.userId, input.matchResultId);
  if (!match) return { status: "not_found" };
  const source = await ports.readEvaluation(match.evaluationId);
  if (!source) throw new Error("Stored match references a missing evaluation");

  const company = source.companyEvaluation
    ? compareTarget(
        profileFromSnapshot(match),
        asTarget(source.companyEvaluation),
        "company",
      )
    : null;
  return {
    status: "found",
    report: buildMatchReport({
      matchResultId: match.matchResultId,
      createdAt: match.createdAt,
      algorithmVersion: match.algorithmVersion,
      profileVersion: match.profileVersion,
      source,
      job: { status: "comparable", source: "job", axes: match.axes },
      company,
      constraints: match.constraints,
    }),
  };
}
