import type { Browser } from "playwright";
import { createBrowserBoundary } from "./browser-boundary.js";
import { createCrawlPolicy } from "./crawl-policy.js";
import {
  fetchPublic,
  requestOnce,
  systemResolver,
  type FetchedResource,
  type RequestOnce,
} from "./safe-http.js";
import {
  extractSourceDocument,
  type ExtractedSourceDocument,
} from "./source-extractor.js";
import {
  FETCH_LIMITS,
  parsePublicUrl,
  type ResolveAddresses,
} from "./url-policy.js";

export class SourceFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceFetchError";
  }
}

function requireHtml(response: FetchedResource): string {
  if (response.status < 200 || response.status >= 300) {
    throw new SourceFetchError("source HTTP response was not successful");
  }
  const contentType = response.headers["content-type"];
  if (
    typeof contentType !== "string" ||
    !/^\s*(text\/html|application\/xhtml\+xml)(\s*;|\s*$)/i.test(contentType)
  ) {
    throw new SourceFetchError("source is not HTML");
  }
  return response.body.toString("utf8");
}

function rejectAccessGate(html: string): void {
  if (/<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(html)) {
    throw new SourceFetchError("source requires authentication");
  }
}

export type SourceFetchResult = {
  document: ExtractedSourceDocument;
  usedBrowser: boolean;
};

export async function fetchSourceDocument(args: {
  url: string;
  siteApproved: (origin: string) => Promise<boolean>;
  browser?: Browser;
  resolve?: ResolveAddresses;
  send?: RequestOnce;
  now?: () => Date;
}): Promise<SourceFetchResult> {
  const initialUrl = parsePublicUrl(args.url);
  const resolve = args.resolve ?? systemResolver;
  const send = args.send ?? requestOnce;
  const now = args.now ?? (() => new Date());
  const rawFetch = (url: string, authorize?: (next: URL) => Promise<void>) =>
    fetchPublic(url, resolve, send, authorize);
  const policy = createCrawlPolicy({
    siteApproved: args.siteApproved,
    fetchRobots: (url) =>
      rawFetch(url, async (next) => {
        if (next.origin !== new URL(url).origin) {
          throw new SourceFetchError("robots redirected across origins");
        }
      }),
  });
  const authorizedFetch = (url: string) => rawFetch(url, policy);
  const response = await authorizedFetch(initialUrl.href);
  const html = requireHtml(response);
  rejectAccessGate(html);
  const httpDocument = extractSourceDocument(html, response.url, now());
  if (httpDocument.sufficient)
    return { document: httpDocument, usedBrowser: false };
  if (!args.browser)
    throw new SourceFetchError("browser fallback is unavailable");

  const boundary = await createBrowserBoundary(args.browser, authorizedFetch);
  try {
    const page = await boundary.context.newPage();
    const navigation = await page.goto(initialUrl.href, {
      waitUntil: "domcontentloaded",
      timeout: FETCH_LIMITS.timeoutMs,
    });
    if (
      !navigation ||
      navigation.status() < 200 ||
      navigation.status() >= 300
    ) {
      throw new SourceFetchError("browser source response was not successful");
    }
    await page
      .waitForFunction(
        () => {
          const content = document.querySelector(
            "[data-job], [itemtype$='/JobPosting'], main",
          );
          return (content?.textContent?.replace(/\s/g, "").length ?? 0) >= 100;
        },
        undefined,
        { timeout: 5_000 },
      )
      .catch(() => undefined);
    const renderedHtml = await page.content();
    rejectAccessGate(renderedHtml);
    const finalUrl = parsePublicUrl(page.url());
    return {
      document: extractSourceDocument(renderedHtml, finalUrl.href, now()),
      usedBrowser: true,
    };
  } finally {
    await boundary.context.close();
  }
}

/**
 * One public HTML page over plain HTTP, for job discovery (ADR-047): the
 * same URL, DNS, redirect, robots, size, time and content-type checks as
 * analysis, no browser, and redirects must stay on the starting origin. The
 * robots policy is shared across calls so one origin's robots.txt is read
 * once per discovery.
 */
export function createPublicPageFetcher(args: {
  resolve?: ResolveAddresses;
  send?: RequestOnce;
}): (url: string) => Promise<{ url: string; html: string }> {
  const resolve = args.resolve ?? systemResolver;
  const send = args.send ?? requestOnce;
  const policy = createCrawlPolicy({
    siteApproved: async () => true,
    fetchRobots: (url) =>
      fetchPublic(url, resolve, send, async (next) => {
        if (next.origin !== new URL(url).origin) {
          throw new SourceFetchError("robots redirected across origins");
        }
      }),
  });
  return async (url) => {
    const origin = parsePublicUrl(url).origin;
    const response = await fetchPublic(url, resolve, send, async (next) => {
      if (next.origin !== origin) {
        throw new SourceFetchError("redirected to another origin");
      }
      await policy(next);
    });
    const html = requireHtml(response);
    rejectAccessGate(html);
    return { url: response.url, html };
  };
}
