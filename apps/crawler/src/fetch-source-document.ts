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
  BROWSER_LIMITS,
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
  /**
   * Requests the browser boundary refused while rendering. A non-zero
   * `blockedRendering` means scripts or data the page needed were refused
   * (robots, size or method), so client-rendered fields may be missing.
   */
  render?: { requests: number; blocked: number; blockedRendering: number };
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
  const rawFetch = (
    url: string,
    authorize?: (next: URL) => Promise<void>,
    maxBytes?: number,
  ) => fetchPublic(url, resolve, send, authorize, maxBytes);
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
  if (!args.browser) {
    if (httpDocument.sufficient)
      return { document: httpDocument, usedBrowser: false };
    throw new SourceFetchError("browser fallback is unavailable");
  }

  // The page itself keeps the page-size limit; the scripts and data it loads
  // to render get the larger subresource budget.
  const pageUrl = initialUrl.href;
  const boundary = await createBrowserBoundary(args.browser, (url) =>
    rawFetch(
      url,
      policy,
      url === pageUrl
        ? FETCH_LIMITS.maxResponseBytes
        : BROWSER_LIMITS.maxSubresourceBytes,
    ),
  );
  const render = () => ({
    requests: boundary.metrics.requests,
    blocked: boundary.metrics.blocked,
    blockedRendering: boundary.metrics.blockedRendering,
  });
  try {
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
        throw new SourceFetchError(
          "browser source response was not successful",
        );
      }
      await page
        .waitForFunction(
          () => {
            const content = document.querySelector(
              "[data-job], [itemtype$='/JobPosting'], main",
            );
            return (
              (content?.textContent?.replace(/\s/g, "").length ?? 0) >= 100
            );
          },
          undefined,
          { timeout: 5_000 },
        )
        .catch(() => undefined);

      // A page can be textually "sufficient" before client-rendered compensation
      // and conditions arrive. Wait briefly for visible text to settle so the
      // rendered document can enrich the static response.
      await page
        .evaluate(async () => {
          let previous = document.body?.innerText ?? "";
          let stableChecks = 0;
          for (let index = 0; index < 10; index += 1) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            const current = document.body?.innerText ?? "";
            if (current === previous) stableChecks += 1;
            else stableChecks = 0;
            previous = current;
            if (index >= 3 && stableChecks >= 2) break;
          }
        })
        .catch(() => undefined);

      const renderedHtml = await page.content();
      rejectAccessGate(renderedHtml);
      const finalUrl = parsePublicUrl(page.url());
      const renderedDocument = extractSourceDocument(
        renderedHtml,
        finalUrl.href,
        now(),
      );
      if (renderedDocument.sufficient) {
        return {
          document: renderedDocument,
          usedBrowser: true,
          render: render(),
        };
      }
      if (httpDocument.sufficient) {
        return { document: httpDocument, usedBrowser: false, render: render() };
      }
      throw new SourceFetchError("rendered source is insufficient");
    } catch (error) {
      if (httpDocument.sufficient) {
        return { document: httpDocument, usedBrowser: false, render: render() };
      }
      throw error;
    }
  } finally {
    await boundary.context.close();
  }
}

const DISCOVERY_TEXT_MARKERS = [
  /仕事内容|業務内容|職務内容|job description|responsibilities/iu,
  /応募資格|必須要件|requirements|qualifications/iu,
  /勤務地|勤務場所|work location|locations?/iu,
  /給与|年収|salary|compensation/iu,
  /応募する|エントリー|apply now|apply for/iu,
] as const;
const DISCOVERY_LINK =
  /href\s*=\s*["'][^"']*(?:jobs?|careers?|recruit|positions?|openings?|job-details?|job-openings?|採用|求人|募集)[^"']*["']/giu;

function discoveryNeedsBrowser(html: string): boolean {
  if (/["']JobPosting["']/u.test(html)) return false;
  const markerCount = DISCOVERY_TEXT_MARKERS.filter((pattern) =>
    pattern.test(html),
  ).length;
  const linkCount = html.match(DISCOVERY_LINK)?.length ?? 0;
  return markerCount < 2 && linkCount < 2;
}

/**
 * One public HTML page for job discovery (ADR-047). Static HTML is preferred.
 * If it looks like a client-rendered shell, Chromium gets one bounded chance
 * to render it through the same DNS/robots/request boundary used by analysis.
 * Redirects of the top-level page must stay on the starting origin.
 */
export function createPublicPageFetcher(args: {
  browser?: Browser;
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
    if (!args.browser || !discoveryNeedsBrowser(html)) {
      return { url: response.url, html };
    }

    const boundary = await createBrowserBoundary(args.browser, (resourceUrl) =>
      fetchPublic(resourceUrl, resolve, send, policy),
    );
    try {
      const page = await boundary.context.newPage();
      await page.goto(response.url, {
        waitUntil: "domcontentloaded",
        timeout: FETCH_LIMITS.timeoutMs,
      });
      await page
        .waitForFunction(
          () =>
            document.querySelectorAll("a").length > 3 ||
            (document.body?.innerText?.replace(/\s/g, "").length ?? 0) > 500,
          undefined,
          { timeout: 4_000 },
        )
        .catch(() => undefined);
      await page.waitForTimeout(500);
      const finalUrl = parsePublicUrl(page.url());
      if (finalUrl.origin !== origin) {
        throw new SourceFetchError("browser redirected to another origin");
      }
      const renderedHtml = await page.content();
      rejectAccessGate(renderedHtml);
      return {
        url: finalUrl.href,
        html: renderedHtml.length > html.length ? renderedHtml : html,
      };
    } catch {
      return { url: response.url, html };
    } finally {
      await boundary.context.close();
    }
  };
}
