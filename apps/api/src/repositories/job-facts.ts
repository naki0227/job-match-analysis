import type { JobOverview } from "@job-match/contracts";
import {
  prefectureCodeFromName,
  type JobConditions,
  type Observation,
  type SalaryOffer,
} from "@job-match/domain";
import { z } from "zod";
import { MatchStoreError } from "./match-store-error.js";

/**
 * Job facts stored by the crawler (evaluation_job_facts), read back as the
 * conditions the match engine compares and the overview users read.
 */
const salaryValue = z.object({
  minimum: z.number().int().nonnegative(),
  maximum: z.number().int().nonnegative(),
  currency: z.string().min(1),
  period: z.string().min(1),
});

function factSchema<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("status", [
    z.object({
      status: z.literal("known"),
      value,
      excerpt: z.string().trim().min(1).optional(),
    }),
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
const sectionFact = factSchema(
  z
    .array(
      z.object({
        section: z.string().trim().min(1).nullable(),
        text: z.string().trim().min(1),
      }),
    )
    .min(1),
);

const SECTION_KINDS = ["duties", "requirements", "workStyle"] as const;
type SectionKind = (typeof SECTION_KINDS)[number];
const isSection = (kind: string): kind is SectionKind =>
  (SECTION_KINDS as readonly string[]).includes(kind);

/** The page text a known fact was read from, when the crawler stored it. */
const withEvidence = (fact: { excerpt?: string | undefined }) =>
  fact.excerpt ? { evidence: fact.excerpt } : {};

/** Job fact kinds the API reads from evaluation_job_facts. */
export const JOB_FACT_KINDS = [
  "salary",
  "location",
  "fullRemote",
  "weeklyOfficeDays",
  "scheduleFlexibility",
  "techStack",
  "employmentType",
  ...SECTION_KINDS,
] as const;

const jobFactRows = z.array(
  z.object({
    kind: z.enum(JOB_FACT_KINDS),
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

export function emptyJobOverview(): JobOverview {
  return {
    salary: { status: "unknown" },
    locations: { status: "unknown" },
    employmentTypes: { status: "unknown" },
    fullRemote: { status: "unknown" },
    weeklyOfficeDays: { status: "unknown" },
    scheduleFlexibility: { status: "unknown" },
    techStack: { status: "unknown" },
    duties: { status: "unknown" },
    requirements: { status: "unknown" },
    workStyle: { status: "unknown" },
  };
}

export function toJobFacts(raw: unknown): {
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
    if (isSection(row.kind)) {
      const parsed = sectionFact.safeParse(row.payload);
      if (!parsed.success) throw new MatchStoreError();
      // Sections are never conflicting: quotes from several places are kept.
      overview[row.kind] =
        parsed.data.status === "known"
          ? { status: "known", quotes: parsed.data.value }
          : { status: "unknown" };
      continue;
    }
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
              ...withEvidence(parsed.data),
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
          ? {
              status: "known",
              values: parsed.data.value,
              ...withEvidence(parsed.data),
            }
          : { status: parsed.data.status };
      continue;
    }
    if (row.kind === "fullRemote") {
      const parsed = remoteFact.safeParse(row.payload);
      if (!parsed.success) throw new MatchStoreError();
      conditions.fullRemote = observation(parsed.data);
      overview.fullRemote =
        parsed.data.status === "known"
          ? {
              status: "known",
              value: parsed.data.value,
              ...withEvidence(parsed.data),
            }
          : { status: parsed.data.status };
      continue;
    }
    if (row.kind === "employmentType") {
      const parsed = employmentTypeFact.safeParse(row.payload);
      if (!parsed.success) throw new MatchStoreError();
      overview.employmentTypes =
        parsed.data.status === "known"
          ? {
              status: "known",
              values: parsed.data.value,
              ...withEvidence(parsed.data),
            }
          : { status: parsed.data.status };
      continue;
    }
    if (row.kind === "weeklyOfficeDays") {
      const parsed = officeDaysFact.safeParse(row.payload);
      if (!parsed.success) throw new MatchStoreError();
      overview.weeklyOfficeDays =
        parsed.data.status === "known"
          ? {
              status: "known",
              value: parsed.data.value,
              ...withEvidence(parsed.data),
            }
          : { status: parsed.data.status };
      continue;
    }
    if (row.kind === "scheduleFlexibility") {
      const parsed = flexibilityFact.safeParse(row.payload);
      if (!parsed.success) throw new MatchStoreError();
      overview.scheduleFlexibility =
        parsed.data.status === "known"
          ? {
              status: "known",
              value: parsed.data.value,
              ...withEvidence(parsed.data),
            }
          : { status: parsed.data.status };
      continue;
    }
    const parsed = techStackFact.safeParse(row.payload);
    if (!parsed.success) throw new MatchStoreError();
    overview.techStack =
      parsed.data.status === "known"
        ? {
            status: "known",
            values: parsed.data.value,
            ...withEvidence(parsed.data),
          }
        : { status: parsed.data.status };
  }

  return { conditions, overview };
}
