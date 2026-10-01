/**
 * Port for finding candidate URLs on the web (ADR-047). Results are only
 * leads: every URL is fetched and verified before it becomes a job
 * candidate. Implementations: DDGS for the beta (best effort); Tavily, Brave
 * Search API or similar later, by adding an adapter.
 */
export type WebSearchInput = { query: string; maxResults: number };

export type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
};

export interface WebSearchProvider {
  readonly name: string;
  search(input: WebSearchInput): Promise<WebSearchResult[]>;
}

export type WebSearchFailure = "timeout" | "blocked" | "unavailable";

export class WebSearchError extends Error {
  constructor(readonly kind: WebSearchFailure) {
    super(`Web search ${kind}`);
    this.name = "WebSearchError";
  }
}
