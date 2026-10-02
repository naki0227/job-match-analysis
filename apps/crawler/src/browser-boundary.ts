import type { Browser, BrowserContext, Request } from "playwright";
import { fetchPublic, type FetchedResource } from "./safe-http.js";
import { BROWSER_LIMITS, FETCH_LIMITS, parsePublicUrl } from "./url-policy.js";

/** Blocked requests of these types can leave job text unrendered. */
const RENDERING_RESOURCES = new Set(["document", "script", "xhr", "fetch"]);

function redirectCount(request: Request): number {
  let count = 0;
  let previous = request.redirectedFrom();
  while (previous) {
    count += 1;
    previous = previous.redirectedFrom();
  }
  return count;
}

export interface BrowserBoundary {
  readonly context: BrowserContext;
  readonly metrics: {
    requests: number;
    bytes: number;
    blocked: number;
    /** Blocked document, script or data requests: the render may be partial. */
    blockedRendering: number;
  };
}

export async function createBrowserBoundary(
  browser: Browser,
  fetchResource: (url: string) => Promise<FetchedResource> = (url) =>
    fetchPublic(url),
): Promise<BrowserBoundary> {
  const context = await browser.newContext({
    serviceWorkers: "block",
    acceptDownloads: false,
    ignoreHTTPSErrors: false,
    permissions: [],
  });
  const metrics = { requests: 0, bytes: 0, blocked: 0, blockedRendering: 0 };
  await context.routeWebSocket("**/*", (route) => {
    metrics.blocked += 1;
    return route.close();
  });
  await context.route("**/*", async (route) => {
    const browserRequest = route.request();
    metrics.requests += 1;
    try {
      if (
        metrics.requests > BROWSER_LIMITS.maxRequests ||
        redirectCount(browserRequest) > FETCH_LIMITS.maxRedirects ||
        browserRequest.method() !== "GET"
      ) {
        throw new Error("browser request limit");
      }
      const url = parsePublicUrl(browserRequest.url());
      const response = await fetchResource(url.href);
      parsePublicUrl(response.url);
      // Redirects are followed only by the pinned Node HTTP boundary.
      // Never hand a 3xx to Chromium, where the next hop could escape routing.
      if (response.status >= 300 && response.status < 400) {
        throw new Error("unresolved browser redirect");
      }
      metrics.bytes += response.body.byteLength;
      if (metrics.bytes > BROWSER_LIMITS.maxTotalBytes)
        throw new Error("browser byte limit");
      const contentType = response.headers["content-type"];
      await route.fulfill({
        status: response.status,
        body: response.body,
        contentType:
          typeof contentType === "string"
            ? contentType
            : "application/octet-stream",
      });
    } catch {
      metrics.blocked += 1;
      if (RENDERING_RESOURCES.has(browserRequest.resourceType()))
        metrics.blockedRendering += 1;
      await route.abort("blockedbyclient");
    }
  });
  return { context, metrics };
}
