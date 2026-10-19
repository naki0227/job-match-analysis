import { createCrawlPolicy } from "../crawl-policy.js";
import {
  fetchPublic,
  requestOnce,
  systemResolver,
  type RequestOnce,
} from "../safe-http.js";
import { parsePublicUrl, type ResolveAddresses } from "../url-policy.js";

export class PublicResourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicResourceError";
  }
}

export type PublicResource = { url: string; body: string };
export type PublicResourceFetcher = (
  url: string,
  accept: RegExp,
) => Promise<PublicResource>;

/**
 * A public non-HTML resource (sitemap XML, Wikidata JSON) for discovery
 * (ADR-051). Same boundary as page fetches: HTTPS only, DNS and redirect
 * checks, robots.txt, size and time limits, and redirects must stay on the
 * starting origin. The caller states which content types it accepts.
 */
export function createPublicResourceFetcher(args: {
  resolve?: ResolveAddresses;
  send?: RequestOnce;
}): PublicResourceFetcher {
  const resolve = args.resolve ?? systemResolver;
  const send = args.send ?? requestOnce;
  const policy = createCrawlPolicy({
    siteApproved: async () => true,
    fetchRobots: (url) =>
      fetchPublic(url, resolve, send, async (next) => {
        if (next.origin !== new URL(url).origin) {
          throw new PublicResourceError("robots redirected across origins");
        }
      }),
  });
  return async (url, accept) => {
    const origin = parsePublicUrl(url).origin;
    const response = await fetchPublic(url, resolve, send, async (next) => {
      if (next.origin !== origin) {
        throw new PublicResourceError("redirected to another origin");
      }
      await policy(next);
    });
    if (response.status < 200 || response.status >= 300) {
      throw new PublicResourceError("resource response was not successful");
    }
    const contentType = response.headers["content-type"];
    if (typeof contentType !== "string" || !accept.test(contentType)) {
      throw new PublicResourceError("resource has an unexpected type");
    }
    return { url: response.url, body: response.body.toString("utf8") };
  };
}
