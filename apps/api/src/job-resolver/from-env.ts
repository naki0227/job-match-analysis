import type { JobResolverDeps } from "@job-match/application";
import { createJevChoiceClient } from "../integrations/jev/choice-client.js";
import { atsAdapters } from "./ats/adapters.js";
import { createAtsSource } from "./ats/ats-source.js";
import { createListingFetch } from "./ats/public-listing.js";
import { createJevCandidateSelector } from "./jev-selector.js";
import {
  createKnownPostingsSource,
  supabaseKnownPostingsSearch,
} from "./known-postings-source.js";

function positive(value: string | undefined): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * Server-side configuration (ADR-045). Returns null when the resolver is not
 * configured; the route then answers 503 and URL input keeps working.
 * - JOB_RESOLVER_MAX_CANDIDATES: most candidates ranked and shown to Jev (≤ 50)
 * - JOB_RESOLVER_ATS_SOURCES: comma list of enabled ATS adapters (default none)
 * - JOB_RESOLVER_FETCH_TIMEOUT_MS: required when any ATS adapter is enabled
 * - JEV_API_KEY + JOB_RESOLVER_JEV_TIMEOUT_MS: optional semantic selection
 */
export function jobResolverDepsFromEnv(
  env: NodeJS.ProcessEnv,
): JobResolverDeps | null {
  const maxCandidates = positive(env.JOB_RESOLVER_MAX_CANDIDATES);
  if (!maxCandidates || maxCandidates > 50) return null;
  const known = createKnownPostingsSource(
    supabaseKnownPostingsSearch(env),
    maxCandidates,
  );
  const enabled = new Set(
    (env.JOB_RESOLVER_ATS_SOURCES ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const adapters = atsAdapters.filter((adapter) => enabled.has(adapter.name));
  if (adapters.length !== enabled.size) return null;
  const sources: JobResolverDeps["sources"][number][] = [known];
  if (adapters.length) {
    const timeout = positive(env.JOB_RESOLVER_FETCH_TIMEOUT_MS);
    if (!timeout) return null;
    sources.push(
      createAtsSource(
        adapters,
        known.urls,
        createListingFetch(
          new Set(adapters.map((adapter) => adapter.host)),
          timeout,
        ),
      ),
    );
  }
  let selector: JobResolverDeps["selector"];
  if (env.JEV_API_KEY) {
    const timeout = positive(env.JOB_RESOLVER_JEV_TIMEOUT_MS);
    if (!timeout) return null;
    selector = createJevCandidateSelector(
      createJevChoiceClient(env.JEV_API_KEY, timeout),
    );
  }
  return { sources, selector, maxCandidates };
}
