const trackingParameters = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
]);
const internalSuffixes = new Set([
  "localhost",
  "local",
  "internal",
  "test",
  "invalid",
]);

export class InvalidAnalysisUrlError extends Error {
  constructor() {
    super("Invalid public analysis URL");
    this.name = "InvalidAnalysisUrlError";
  }
}

/**
 * Canonical form of a public job URL, shared by the API and the crawler so
 * that a URL found by discovery and the same URL pasted by a user map to one
 * source_urls row.
 */
export function normalizeAnalysisUrl(rawUrl: string): string {
  if (rawUrl.length > 2048 || rawUrl.trim() !== rawUrl) {
    throw new InvalidAnalysisUrlError();
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InvalidAnalysisUrlError();
  }
  const labels = url.hostname.split(".");
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    // IP literals: IPv4 parses to dotted decimal; IPv6 keeps its brackets
    // and fails the label check below.
    /^\d+(?:\.\d+){3}$/.test(url.hostname) ||
    /^\d+$/.test(labels.at(-1) ?? "") ||
    labels.length < 2 ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    ) ||
    internalSuffixes.has(labels.at(-1) ?? "")
  ) {
    throw new InvalidAnalysisUrlError();
  }
  url.hash = "";
  for (const key of trackingParameters) url.searchParams.delete(key);
  if (url.href.length > 2048) throw new InvalidAnalysisUrlError();
  return url.href;
}
