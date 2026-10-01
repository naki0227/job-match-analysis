import type { JobResolverDeps } from "@job-match/application";
import { createJevChoiceClient } from "../integrations/jev/choice-client.js";
import {
  createDiscoveryStore,
  supabaseResolverRpc,
  type DiscoveryPolicy,
  type DiscoveryStore,
} from "./discovery-store.js";
import { createJevCandidateSelector } from "./jev-selector.js";
import { createKnownPostingsSource } from "./known-postings-source.js";

function positive(value: string | undefined): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export type ResolverRuntime = {
  deps: Omit<JobResolverDeps, "discovery">;
  store: DiscoveryStore;
  searchLimit: { limit: number; windowSeconds: number };
  /** Web discovery (ADR-047); absent when not configured. */
  discovery: DiscoveryPolicy | null;
};

/**
 * Server-side configuration (ADR-045, ADR-047). Returns null when the
 * resolver is not configured; the route then answers 503 and URL input keeps
 * working. Every value is explicit; nothing has a hidden default.
 * - JOB_RESOLVER_MAX_CANDIDATES (≤ 50), JOB_RESOLVER_LISTING_LIMIT (≤ 20),
 *   JOB_RESOLVER_KNOWN_LISTING_MINIMUM
 * - JOB_RESOLVER_SEARCH_LIMIT per JOB_RESOLVER_SEARCH_WINDOW_SECONDS per user
 * - JEV_API_KEY + JOB_RESOLVER_JEV_TIMEOUT_MS: optional semantic selection
 * - JOB_DISCOVERY_FRESHNESS_SECONDS, JOB_DISCOVERY_USER_LIMIT,
 *   JOB_DISCOVERY_WINDOW_SECONDS, JOB_DISCOVERY_MAX_ACTIVE,
 *   JOB_DISCOVERY_RETENTION_SECONDS: all or none (web discovery)
 */
export function resolverRuntimeFromEnv(
  env: NodeJS.ProcessEnv,
  now: () => Date = () => new Date(),
): ResolverRuntime | null {
  const maxCandidates = positive(env.JOB_RESOLVER_MAX_CANDIDATES);
  const listingLimit = positive(env.JOB_RESOLVER_LISTING_LIMIT);
  const knownListingMinimum = positive(env.JOB_RESOLVER_KNOWN_LISTING_MINIMUM);
  const searchLimit = positive(env.JOB_RESOLVER_SEARCH_LIMIT);
  const searchWindow = positive(env.JOB_RESOLVER_SEARCH_WINDOW_SECONDS);
  if (
    !maxCandidates ||
    maxCandidates > 50 ||
    !listingLimit ||
    listingLimit > 20 ||
    !knownListingMinimum ||
    !searchLimit ||
    !searchWindow
  )
    return null;
  const discoveryValues = [
    env.JOB_DISCOVERY_FRESHNESS_SECONDS,
    env.JOB_DISCOVERY_USER_LIMIT,
    env.JOB_DISCOVERY_WINDOW_SECONDS,
    env.JOB_DISCOVERY_MAX_ACTIVE,
    env.JOB_DISCOVERY_RETENTION_SECONDS,
  ].map(positive);
  const anyDiscovery = [
    env.JOB_DISCOVERY_FRESHNESS_SECONDS,
    env.JOB_DISCOVERY_USER_LIMIT,
    env.JOB_DISCOVERY_WINDOW_SECONDS,
    env.JOB_DISCOVERY_MAX_ACTIVE,
    env.JOB_DISCOVERY_RETENTION_SECONDS,
  ].some((value) => value !== undefined && value !== "");
  if (anyDiscovery && discoveryValues.some((value) => value === null))
    return null;
  let selector: JobResolverDeps["selector"];
  if (env.JEV_API_KEY) {
    const timeout = positive(env.JOB_RESOLVER_JEV_TIMEOUT_MS);
    if (!timeout) return null;
    selector = createJevCandidateSelector(
      createJevChoiceClient(env.JEV_API_KEY, timeout),
    );
  }
  const rpc = supabaseResolverRpc(env);
  const [
    freshnessSeconds,
    userLimit,
    windowSeconds,
    maxActive,
    retentionSeconds,
  ] = discoveryValues as number[];
  return {
    deps: {
      sources: [
        createKnownPostingsSource(
          (args) => rpc("search_known_job_postings", args),
          maxCandidates,
        ),
      ],
      selector,
      maxCandidates,
      listingLimit,
      knownListingMinimum,
    },
    store: createDiscoveryStore(rpc, now),
    searchLimit: { limit: searchLimit, windowSeconds: searchWindow },
    discovery: anyDiscovery
      ? {
          freshnessSeconds: freshnessSeconds!,
          userLimit: userLimit!,
          windowSeconds: windowSeconds!,
          maxActive: maxActive!,
          retentionSeconds: retentionSeconds!,
        }
      : null,
  };
}
