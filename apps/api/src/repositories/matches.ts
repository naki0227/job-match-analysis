import type {
  CommitMatchInput,
  CommittedMatch,
  EvaluationSnapshot,
  MatchEvaluationSource,
  StoredMatch,
} from "@job-match/application";
import { careerAxisKeys } from "@job-match/contracts";
import {
  type AxisComparison,
  type AxisEvidence,
  type AxisObservation,
} from "@job-match/domain";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { emptyJobOverview, JOB_FACT_KINDS, toJobFacts } from "./job-facts.js";
import { MatchStoreError } from "./match-store-error.js";

export { MatchStoreError };

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const axisKey = z.enum(careerAxisKeys);
const anchor = z.union([z.literal(0), z.literal(50), z.literal(100)]);
const observationStatus = z.enum([
  "known",
  "unknown",
  "conflicting",
  "stale",
  "range",
]);

const snapshotSchema = z.object({
  evaluationId: uuid,
  evaluatedAt: timestamp,
  axisCatalogVersion: z.number().int().positive(),
  axisValues: z.array(
    z.object({
      axisKey,
      axisVersion: z.number().int().positive(),
      observationStatus,
      anchorValue: anchor.nullable(),
      // Absent from rows written before ranges existed.
      anchorMax: anchor.nullable().optional(),
    }),
  ),
  evidence: z.array(
    z.object({
      axisKey,
      quote: z.string().trim().min(1),
      sourceUrl: z.url(),
      fetchedAt: timestamp,
    }),
  ),
});

const evaluationSourceSchema = z.object({
  targetType: z.enum(["job", "company"]),
  companyName: z.string().trim().min(1),
  jobTitle: z.string().trim().min(1).nullable(),
  evaluation: snapshotSchema,
  companyEvaluation: snapshotSchema.nullable(),
});

const committedSchema = z
  .array(
    z.object({
      match_result_id: uuid,
      created_at: timestamp,
      created: z.boolean(),
    }),
  )
  .length(1);

const storedMatchSchema = z.object({
  matchResultId: uuid,
  createdAt: timestamp,
  algorithmVersion: z.string().trim().min(1),
  evaluationId: uuid,
  profileVersion: z.number().int().positive(),
  axisCatalogVersion: z.number().int().positive(),
  axes: z
    .array(
      z.object({
        axisKey,
        preference: z.number().int().min(0).max(100),
        importance: z.number().int().min(0).max(100),
        observationStatus,
        observedAnchor: anchor.nullable(),
        observedAnchorMax: anchor.nullable().optional(),
        comparisonStatus: z.enum([
          "close",
          "different",
          "partial",
          "excluded",
          "unknown",
          "conflicting",
          "stale",
        ]),
        difference: z.number().int().min(0).max(100).nullable(),
        differenceMax: z.number().int().min(0).max(100).nullable().optional(),
      }),
    )
    .length(careerAxisKeys.length),
  constraints: z
    .array(
      z.object({
        kind: z.enum(["min_salary", "location", "full_remote"]),
        status: z.enum(["met", "unmet", "unknown", "not_required"]),
        reason: z
          .enum([
            "missing_information",
            "conflicting_information",
            "stale_information",
            "salary_unit_mismatch",
            "salary_range_overlaps_minimum",
            "salary_below_minimum",
            "location_outside_allowed",
            "regular_office_attendance_required",
          ])
          .nullable(),
      }),
    )
    .length(3),
});

export type MatchRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export type JobFactsReader = (evaluationId: string) => Promise<unknown>;

type Status = z.infer<typeof observationStatus>;

/**
 * DB rows keep one value for known/stale and two adjacent anchors for a
 * range; anything else is corrupt.
 */
function toObservation(
  status: Status,
  value: 0 | 50 | 100 | null,
  maximum: 0 | 50 | 100 | null = null,
): AxisObservation {
  if (status === "range") {
    if (value === 0 && maximum === 50)
      return { status, minimum: 0, maximum: 50 };
    if (value === 50 && maximum === 100)
      return { status, minimum: 50, maximum: 100 };
    throw new MatchStoreError();
  }
  if (maximum !== null) throw new MatchStoreError();
  if (status === "known" || status === "stale") {
    if (value === null) throw new MatchStoreError();
    return { status, value };
  }
  if (value !== null) throw new MatchStoreError();
  return { status };
}

/** The lower and upper anchors stored for an observation. */
function anchorsOf(observation: AxisObservation) {
  if (observation.status === "range")
    return { anchor: observation.minimum, anchorMax: observation.maximum };
  if (observation.status === "known" || observation.status === "stale")
    return { anchor: observation.value, anchorMax: null };
  return { anchor: null, anchorMax: null };
}

function toSnapshot(raw: z.infer<typeof snapshotSchema>): EvaluationSnapshot {
  const axisValues: AxisEvidence[] = raw.axisValues.map((axis) => ({
    axisKey: axis.axisKey,
    axisVersion: axis.axisVersion,
    observation: toObservation(
      axis.observationStatus,
      axis.anchorValue,
      axis.anchorMax ?? null,
    ),
  }));
  return {
    evaluationId: raw.evaluationId,
    evaluatedAt: raw.evaluatedAt,
    axisCatalogVersion: raw.axisCatalogVersion,
    axisValues,
    evidence: raw.evidence,
  };
}

function toStoredMatch(raw: z.infer<typeof storedMatchSchema>): StoredMatch {
  const byKey = new Map(raw.axes.map((axis) => [axis.axisKey, axis]));
  const axes: AxisComparison[] = careerAxisKeys.map((key) => {
    const axis = byKey.get(key);
    if (!axis) throw new MatchStoreError();
    return {
      axisKey: key,
      source: "job",
      preference: axis.preference,
      importance: axis.importance,
      observation: toObservation(
        axis.observationStatus,
        axis.observedAnchor,
        axis.observedAnchorMax ?? null,
      ),
      status: axis.comparisonStatus,
      ...(axis.difference === null ? {} : { difference: axis.difference }),
      ...(axis.differenceMax == null
        ? {}
        : { differenceMax: axis.differenceMax }),
    };
  });
  return {
    matchResultId: raw.matchResultId,
    createdAt: raw.createdAt,
    algorithmVersion: raw.algorithmVersion,
    evaluationId: raw.evaluationId,
    profileVersion: raw.profileVersion,
    axisCatalogVersion: raw.axisCatalogVersion,
    axes,
    constraints: raw.constraints.map(({ kind, status, reason }) => ({
      kind,
      status,
      ...(reason === null ? {} : { reason }),
    })),
  };
}

async function call(
  rpc: MatchRpc,
  name: string,
  args: Record<string, unknown>,
) {
  try {
    return await rpc(name, args);
  } catch {
    throw new MatchStoreError();
  }
}

export function createMatchRepository(
  rpc: MatchRpc,
  readJobFacts: JobFactsReader = async () => [],
) {
  return {
    async readEvaluation(
      evaluationId: string,
    ): Promise<MatchEvaluationSource | null> {
      const raw = await call(rpc, "read_evaluation_for_match", {
        p_evaluation_id: evaluationId,
      });
      if (raw === null) return null;
      const parsed = evaluationSourceSchema.safeParse(raw);
      if (!parsed.success) throw new MatchStoreError();
      const source = parsed.data;
      const facts =
        source.targetType === "job"
          ? toJobFacts(await readJobFacts(source.evaluation.evaluationId))
          : { conditions: {}, overview: emptyJobOverview() };
      return {
        targetType: source.targetType,
        companyName: source.companyName,
        jobTitle: source.jobTitle,
        evaluation: toSnapshot(source.evaluation),
        jobConditions: facts.conditions,
        jobOverview: facts.overview,
        companyEvaluation: source.companyEvaluation
          ? toSnapshot(source.companyEvaluation)
          : null,
      };
    },

    async commitMatch(input: CommitMatchInput): Promise<CommittedMatch> {
      const raw = await call(rpc, "commit_match_result", {
        p_user_id: input.userId,
        p_profile_version_id: input.profileVersionId,
        p_evaluation_id: input.evaluationId,
        p_algorithm_version: input.algorithmVersion,
        p_axes: input.axes.map((axis) => ({
          axisKey: axis.axisKey,
          preference: axis.preference,
          importance: axis.importance,
          observationStatus: axis.observation.status,
          observedAnchor: anchorsOf(axis.observation).anchor,
          observedAnchorMax: anchorsOf(axis.observation).anchorMax,
          comparisonStatus: axis.status,
          difference: axis.difference ?? null,
          differenceMax: axis.differenceMax ?? null,
        })),
        p_constraints: input.constraints.map((constraint) => ({
          kind: constraint.kind,
          status: constraint.status,
          reason: constraint.reason ?? null,
        })),
      });
      const parsed = committedSchema.safeParse(raw);
      const row = parsed.success ? parsed.data[0] : undefined;
      if (!row) throw new MatchStoreError();
      return {
        matchResultId: row.match_result_id,
        createdAt: row.created_at,
        created: row.created,
      };
    },

    async readMatch(
      userId: string,
      matchResultId: string,
    ): Promise<StoredMatch | null> {
      const raw = await call(rpc, "read_match_result", {
        p_user_id: userId,
        p_match_result_id: matchResultId,
      });
      if (raw === null) return null;
      const parsed = storedMatchSchema.safeParse(raw);
      if (!parsed.success) throw new MatchStoreError();
      return toStoredMatch(parsed.data);
    },
  };
}

export type MatchRepository = ReturnType<typeof createMatchRepository>;

export function createSupabaseMatchRepository(): MatchRepository {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new MatchStoreError();
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createMatchRepository(
    async (name, args) => {
      const { data, error } = await client.rpc(name, args);
      if (error) throw new MatchStoreError();
      return data;
    },
    async (evaluationId) => {
      const { data, error } = await client
        .from("evaluation_job_facts")
        .select("kind,payload")
        .eq("evaluation_id", evaluationId)
        .in("kind", [...JOB_FACT_KINDS]);
      if (error) throw new MatchStoreError();
      return data ?? [];
    },
  );
}
