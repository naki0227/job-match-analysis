import type {
  CommitMatchInput,
  CommittedMatch,
  EvaluationSnapshot,
  MatchEvaluationSource,
  StoredMatch,
} from "@job-match/application";
import { careerAxisKeys, type JobOverview } from "@job-match/contracts";
import {
  prefectureCodeFromName,
  type AxisComparison,
  type AxisEvidence,
  type JobConditions,
  type Observation,
  type SalaryOffer,
} from "@job-match/domain";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const axisKey = z.enum(careerAxisKeys);
const anchor = z.union([z.literal(0), z.literal(50), z.literal(100)]);
const observationStatus = z.enum(["known", "unknown", "conflicting", "stale"]);

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
        comparisonStatus: z.enum([
          "close",
          "different",
          "excluded",
          "unknown",
          "conflicting",
          "stale",
        ]),
        difference: z.number().int().min(0).max(100).nullable(),
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

const salaryValue = z.object({
  minimum: z.number().int().nonnegative(),
  maximum: z.number().int().nonnegative(),
  currency: z.string().min(1),
  period: z.string().min(1),
});

function factSchema<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("known"), value }),
    z.object({ status: z.literal("unknown") }),
    z.object({ status: z.literal("conflicting") }),
  ]);
}

const salaryFact = factSchema(salaryValue);
const locationFact = factSchema(z.array(z.string().min(1)).min(1));
const remoteFact = factSchema(z.boolean());
const employmentTypeFact = factSchema(z.array(z.string().min(1)).min(1));
const officeDaysFact = factSchema(z.number().int().min(0).max(5));
const flexibilityFact = factSchema(
  z.union([z.literal(0), z.literal(50), z.literal(100)]),
);
const techStackFact = factSchema(z.array(z.string().min(1)).min(1));

const jobFactRows = z.array(
  z.object({
    kind: z.enum([
      "salary",
      "location",
      "fullRemote",
      "weeklyOfficeDays",
      "scheduleFlexibility",
      "techStack",
      "employmentType",
    ]),
    payload: z.unknown(),
  }),
);

function observation<T>(
  parsed: { status: "known"; value: T } | { status: "unknown" | "conflicting" },
): Observation<T> {
  return parsed.status === "known"
    ? { status: "known", value: parsed.value }
    : { status: parsed.status };
}

function emptyJobOverview(): JobOverview {
  return {
    salary: { status: "unknown" },
    locations: { status: "unknown" },
    employmentTypes: { status: "unknown" },
    fullRemote: { status: "unknown" },
    weeklyOfficeDays: { status: "unknown" },
    scheduleFlexibility: { status: "unknown" },
    techStack: { status: "unknown" },
  };
}

function toJobFacts(raw: unknown): {
  conditions: JobConditions;
  overview: JobOverview;
} {
  const rows = jobFactRows.safeParse(raw);
  if (!rows.success) throw new MatchStoreError();

  const conditions: {
    salary?: Observation<SalaryOffer>;
    availablePrefectureCodes?: Observation<readonly string[]>;
    fullRemote?: Observation<boolean>;
  } = {};
  const overview = emptyJobOverview();

  for (const row of rows.data) {
    if (row.kind === "salary") {
      const parsed = salaryFact.safeParse(row.payload);
      if (!parsed.success) throw new MatchStoreError();
      conditions.salary = observation(parsed.data);
      overview.salary =
        parsed.data.status === "known"
          ? {
              status: "known",
              minimum: parsed.data.value.minimum,
              maximum: parsed.data.value.maximum,
              currency: parsed.data.value.currency,
              period: parsed.data.value.period,
            }
          : { status: parsed.data.status };
      continue;
    }
    if (row.kind === "location") {
      const parsed = locationFact.safeParse(row.payload);
      if (!parsed.success) throw new MatchStoreError();
      conditions.availablePrefectureCodes =
        parsed.data.status === "known"
          ? {
              status: "known",
              value: parsed.data.value.map(prefectureCodeFromName),
            }
          : { status: parsed.data.status };
      overview.locations =
        parsed.data.status === "known"
          ? { status: "known", values: parsed.data.value }
          : { status: parsed.data.status };
      continue;
    }
    if (row.kind === "fullRemote") {
      const parsed = remoteFact.safeParse(row.payload);
      if (!parsed.success) throw new MatchStoreError();
      conditions.fullRemote = observation(parsed.data);
      overview.fullRemote =
        parsed.data.status === "known"
          ? { status: "known", value: parsed.data.value }
          : { status: parsed.data.status };
      continue;
    }
    if (row.kind === "employmentType") {
      const parsed = employmentTypeFact.safeParse(row.payload);
      if (!parsed.success) throw new MatchStoreError();
      overview.employmentTypes =
        parsed.data.status === "known"
          ? { status: "known", values: parsed.data.value }
          : { status: parsed.data.status };
      continue;
    }
    if (row.kind === "weeklyOfficeDays") {
      const parsed = officeDaysFact.safeParse(row.payload);
      if (!parsed.success) throw new MatchStoreError();
      overview.weeklyOfficeDays =
        parsed.data.status === "known"
          ? { status: "known", value: parsed.data.value }
          : { status: parsed.data.status };
      continue;
    }
    if (row.kind === "scheduleFlexibility") {
      const parsed = flexibilityFact.safeParse(row.payload);
      if (!parsed.success) throw new MatchStoreError();
      overview.scheduleFlexibility =
        parsed.data.status === "known"
          ? { status: "known", value: parsed.data.value }
          : { status: parsed.data.status };
      continue;
    }
    const parsed = techStackFact.safeParse(row.payload);
    if (!parsed.success) throw new MatchStoreError();
    overview.techStack =
      parsed.data.status === "known"
        ? { status: "known", values: parsed.data.value }
        : { status: parsed.data.status };
  }

  return { conditions, overview };
}

export class MatchStoreError extends Error {
  constructor() {
    super("Match storage is unavailable");
    this.name = "MatchStoreError";
  }
}

type Status = z.infer<typeof observationStatus>;

/** DB rows keep the value only for known/stale; anything else is corrupt. */
function toObservation(status: Status, value: 0 | 50 | 100 | null) {
  if (status === "known" || status === "stale") {
    if (value === null) throw new MatchStoreError();
    return { status, value } as const;
  }
  if (value !== null) throw new MatchStoreError();
  return { status } as const;
}

function toSnapshot(raw: z.infer<typeof snapshotSchema>): EvaluationSnapshot {
  const axisValues: AxisEvidence[] = raw.axisValues.map((axis) => ({
    axisKey: axis.axisKey,
    axisVersion: axis.axisVersion,
    observation: toObservation(axis.observationStatus, axis.anchorValue),
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
      observation: toObservation(axis.observationStatus, axis.observedAnchor),
      status: axis.comparisonStatus,
      ...(axis.difference === null ? {} : { difference: axis.difference }),
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
          observedAnchor:
            axis.observation.status === "known" ||
            axis.observation.status === "stale"
              ? axis.observation.value
              : null,
          comparisonStatus: axis.status,
          difference: axis.difference ?? null,
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
        .in("kind", [
          "salary",
          "location",
          "fullRemote",
          "weeklyOfficeDays",
          "scheduleFlexibility",
          "techStack",
          "employmentType",
        ]);
      if (error) throw new MatchStoreError();
      return data ?? [];
    },
  );
}
