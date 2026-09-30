import { readPublicShare, type SharePorts } from "@job-match/application";
import { shareTokenSchema } from "@job-match/contracts";
import { Hono } from "hono";
import { loadOgFont } from "./og-font.js";
import { renderShareHtml, renderUnavailableHtml } from "./render-html.js";
import { renderShareOgPng } from "./render-og.js";

export type SharePageConfig = {
  /** Public origin where /s/<token> is served; defaults to the request's. */
  shareOrigin?: string;
  /** Where the SPA lives, for the call to action. */
  appUrl: string;
};

export function sharePageConfigFromEnv(): SharePageConfig {
  return {
    shareOrigin: process.env.PUBLIC_SHARE_ORIGIN || undefined,
    appUrl: process.env.PUBLIC_APP_URL || "/",
  };
}

const publicHeaders = {
  // Revocation must take effect on the next request.
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

/**
 * Server-rendered share page and OG image (Issue #39). Both read only the
 * stored public projection through readPublicShare; malformed, unknown and
 * revoked tokens get the same 404.
 */
export function createSharePageRoutes(
  portsDeps: () => Pick<SharePorts, "readPublicShare">,
  config: () => SharePageConfig = sharePageConfigFromEnv,
  font: () => Promise<Buffer> = loadOgFont,
) {
  const app = new Hono();

  async function find(token: string | undefined) {
    const parsed = shareTokenSchema.safeParse(token);
    if (!parsed.success) return null;
    return readPublicShare(portsDeps(), parsed.data);
  }

  app.get("/s/:token", async (c) => {
    const settings = config();
    for (const [name, value] of Object.entries(publicHeaders)) {
      c.header(name, value);
    }
    try {
      const token = c.req.param("token");
      const share = await find(token);
      if (!share) return c.html(renderUnavailableHtml(settings.appUrl), 404);
      const origin = settings.shareOrigin ?? new URL(c.req.url).origin;
      const page = `${origin}/s/${token}`;
      return c.html(
        renderShareHtml(share, {
          page,
          image: `${page}/og.png`,
          app: settings.appUrl,
        }),
        200,
      );
    } catch {
      return c.html(renderUnavailableHtml(settings.appUrl), 503);
    }
  });

  app.get("/s/:token/og.png", async (c) => {
    for (const [name, value] of Object.entries(publicHeaders)) {
      c.header(name, value);
    }
    try {
      const share = await find(c.req.param("token"));
      if (!share) return c.body(null, 404);
      const png = await renderShareOgPng(share.projection, {
        font: await font(),
      });
      c.header("Content-Type", "image/png");
      return c.body(new Uint8Array(png), 200);
    } catch {
      return c.body(null, 503);
    }
  });

  return app;
}
