import type { CandidateSource } from "@job-match/application";
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

/** Postings this service has already analyzed or discovered (first source). */
export function createKnownPostingsSource(
  search: SearchRpc,
  limit: number,
): CandidateSource {
  return {
    name: "known",
    async discover(query) {
      const rows = rowsSchema.parse(
        await search({ p_company: query.company, p_limit: limit }),
      );
      return rows.map((row) => ({
        companyName: row.company_name,
        title: row.title,
        url: row.url,
        source: "known",
        employmentTypes: row.employment_types,
      }));
    },
  };
}
