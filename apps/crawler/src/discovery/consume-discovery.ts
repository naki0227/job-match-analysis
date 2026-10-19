import { randomUUID } from "node:crypto";
import type { CrawlerMetrics } from "../crawler-metrics.js";
import {
  discoverJobs,
  type DiscoveryLimits,
  type PageFetcher,
} from "./discover-jobs.js";
import type { DiscoveryErrorCode, DiscoveryStore } from "./discovery-store.js";
import type { OfficialLeadResult } from "./official-leads.js";
import type { DiscoveryQuery } from "./queries.js";
import type { WebSearchFailure, WebSearchProvider } from "./web-search.js";

export type DiscoveryRuntime = {
  store: DiscoveryStore;
  search: WebSearchProvider;
  /** A fresh fetcher per discovery, so robots.txt is cached only per run. */
  createFetcher: () => PageFetcher;
  /** Leads from the employer's own sites (ADR-051), using that fetcher. */
  createOfficialLeads?: (
    fetchPage: PageFetcher,
  ) => (query: DiscoveryQuery) => Promise<OfficialLeadResult>;
  limits: DiscoveryLimits;
  leaseSeconds: number;
  maxAttempts: number;
};

export type DiscoveryOutcome = "idle" | "completed" | "retry" | "failed";

const failureCodes: Record<WebSearchFailure, DiscoveryErrorCode> = {
  blocked: "search_blocked",
  timeout: "search_timeout",
  unavailable: "search_unavailable",
};

/** Claims one queued discovery and finishes it, or returns idle. */
export async function consumeOneDiscovery(
  runtime: DiscoveryRuntime,
  metrics: CrawlerMetrics,
  now: () => Date = () => new Date(),
): Promise<DiscoveryOutcome> {
  const token = randomUUID();
  const claimed = await runtime.store.claim(
    token,
    runtime.leaseSeconds,
    runtime.maxAttempts,
  );
  if (!claimed) return "idle";
  const started = performance.now();
  try {
    const fetchPage = runtime.createFetcher();
    const result = await discoverJobs({
      query: claimed.query,
      search: runtime.search,
      fetchPage,
      ...(runtime.createOfficialLeads
        ? { officialLeads: runtime.createOfficialLeads(fetchPage) }
        : {}),
      limits: runtime.limits,
      now: now(),
    });
    const lastAttempt = claimed.attempts >= runtime.maxAttempts;
    const outcome: DiscoveryOutcome =
      result.searchFailure && !lastAttempt
        ? "retry"
        : result.searchFailure
          ? "failed"
          : "completed";
    if (result.searchFailure) {
      await runtime.store.fail(
        claimed.discoveryId,
        token,
        failureCodes[result.searchFailure],
        runtime.maxAttempts,
      );
    } else {
      await runtime.store.complete(claimed.discoveryId, token, result.postings);
    }
    metrics.discovery({
      ...result.stats,
      outcome,
      durationMs: performance.now() - started,
    });
    return outcome;
  } catch (error) {
    await runtime.store
      .fail(claimed.discoveryId, token, "internal", runtime.maxAttempts)
      .catch(() => undefined);
    metrics.discovery({
      officialLeads: 0,
      queries: 0,
      searchFailures: {},
      searchResults: 0,
      fetched: 0,
      listingsExpanded: 0,
      verified: 0,
      rejected: {},
      outcome: "failed",
      durationMs: performance.now() - started,
    });
    throw error;
  }
}
