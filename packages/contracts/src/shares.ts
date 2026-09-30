import { z } from "zod";
import { careerAxisKeys } from "./career-profile.js";
import { matchAxisStatuses, type MatchReport } from "./matches.js";

const timestamp = z.iso.datetime({ offset: true });

/** 32 random bytes in base64url: long enough that links cannot be guessed. */
export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/**
 * The only Match data that may be published. It carries per-axis judgements
 * but no preference or observed values, hard constraints, evidence, profile
 * versions or account data, and never an overall score.
 */
export const sharedMatchSchema = z.strictObject({
  companyName: z.string().trim().min(1),
  jobTitle: z.string().trim().min(1),
  evaluatedAt: timestamp,
  axes: z
    .array(
      z.strictObject({
        axisKey: z.enum(careerAxisKeys),
        status: z.enum(matchAxisStatuses),
      }),
    )
    .length(careerAxisKeys.length),
});

export const matchShareSchema = z.strictObject({
  shareId: z.uuid(),
  token: shareTokenSchema,
  sharedAt: timestamp,
  projection: sharedMatchSchema,
});

export const publicShareSchema = z.strictObject({
  sharedAt: timestamp,
  projection: sharedMatchSchema,
});

export type SharedMatch = z.infer<typeof sharedMatchSchema>;
export type MatchShare = z.infer<typeof matchShareSchema>;
export type PublicShare = z.infer<typeof publicShareSchema>;

/**
 * Builds the public projection of a personal Match. Server and Web share this
 * one definition so the saved link and the on-screen card cannot drift.
 */
export function toSharedMatch(report: MatchReport): SharedMatch {
  if (report.job.status !== "comparable") {
    throw new RangeError("Only comparable job results can be shared");
  }
  const byKey = new Map(report.job.axes.map((axis) => [axis.axisKey, axis]));
  return {
    companyName: report.companyName,
    jobTitle: report.jobTitle,
    evaluatedAt: report.job.evaluatedAt,
    axes: careerAxisKeys.map((axisKey) => {
      const axis = byKey.get(axisKey);
      if (!axis) throw new RangeError("Match report is missing an axis");
      return { axisKey, status: axis.status };
    }),
  };
}

export type SharedMatchSummary = {
  close: number;
  different: number;
  /** unknown, conflicting and stale together: not yet known, never a score. */
  unknown: number;
  closeAxes: SharedMatch["axes"][number]["axisKey"][];
};

/** Counts shown on share cards, derived only from the public projection. */
export function summarizeSharedMatch(
  projection: SharedMatch,
): SharedMatchSummary {
  const count = (statuses: readonly string[]) =>
    projection.axes.filter((axis) => statuses.includes(axis.status)).length;
  return {
    close: count(["close"]),
    different: count(["different"]),
    unknown: count(["unknown", "conflicting", "stale"]),
    closeAxes: projection.axes
      .filter((axis) => axis.status === "close")
      .slice(0, 3)
      .map((axis) => axis.axisKey),
  };
}
