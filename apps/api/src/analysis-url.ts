import { isIP } from "node:net";

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
    isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0 ||
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
