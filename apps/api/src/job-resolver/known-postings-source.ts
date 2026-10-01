import type { CandidateSource } from "@job-match/application";
import type { JobCandidate } from "@job-match/domain";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const rowsSchema = z
  .array(
    z.object({
      company_name: z.string().min(1),
      title: z.string().min(1),
      url: z.url({ protocol: /^https$/ }),
      employment_types: z.array(z.string()).max(10),
    }),
  )
  .max(50);

type SearchRpc = (args: {
  p_company: string;
  p_limit: number;
}) => Promise<unknown>;

/** Postings this service has already analyzed (ADR-045, first source). */
export function createKnownPostingsSource(
  search: SearchRpc,
  limit: number,
): CandidateSource & {
  urls: (company: string) => Promise<readonly JobCandidate[]>;
} {
  const urls = async (company: string): Promise<JobCandidate[]> => {
    const rows = rowsSchema.parse(
      await search({ p_company: company, p_limit: limit }),
    );
    return rows.map((row) => ({
      companyName: row.company_name,
      title: row.title,
      url: row.url,
      source: "known",
      employmentTypes: row.employment_types,
    }));
  };
  return { name: "known", discover: (query) => urls(query.company), urls };
}

export function supabaseKnownPostingsSearch(env: NodeJS.ProcessEnv): SearchRpc {
  const url = env.SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Supabase is not configured");
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return async (args) => {
    const { data, error } = await client.rpc("search_known_job_postings", args);
    if (error) throw new Error("Known posting search failed");
    return data;
  };
}
