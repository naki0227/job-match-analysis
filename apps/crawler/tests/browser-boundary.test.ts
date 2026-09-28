import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { createBrowserBoundary } from "../src/browser-boundary.js";
import type { FetchedResource } from "../src/safe-http.js";

function resource(
  url: string,
  body: string,
  contentType: string,
  status = 200,
  location?: string,
): FetchedResource {
  return {
    url,
    status,
    headers: {
      "content-type": contentType,
      ...(location ? { location } : {}),
    },
    body: Buffer.from(body),
  };
}

describe("browser network boundary", () => {
  it("intercepts JS and blocks private image, XHR and WebSocket targets", async () => {
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      const visited: string[] = [];
      const boundary = await createBrowserBoundary(browser, async (url) => {
        visited.push(url);
        if (url.endsWith("/app.js")) {
          return resource(
            url,
            'fetch("https://127.0.0.1/private").catch(() => {}); new WebSocket("wss://127.0.0.1/private"); document.body.dataset.script = "loaded";',
            "text/javascript",
          );
        }
        return resource(
          url,
          '<!doctype html><html><body><img src="https://169.254.169.254/metadata"><script src="https://script.example/app.js"></script></body></html>',
          "text/html",
        );
      });
      try {
        const page = await boundary.context.newPage();
        await page.goto("https://fixture.example/", { waitUntil: "load" });
        await page.waitForFunction(
          () => document.body.dataset.script === "loaded",
        );
        await expect
          .poll(() => boundary.metrics.blocked)
          .toBeGreaterThanOrEqual(3);
        expect(visited).toEqual([
          "https://fixture.example/",
          "https://script.example/app.js",
        ]);
        expect(boundary.metrics.requests).toBeGreaterThanOrEqual(4);
      } finally {
        await boundary.context.close();
      }
    } finally {
      await browser.close();
    }
  }, 15_000);

  it("rejects an unsafe browser redirect before fetching its target", async () => {
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      const visited: string[] = [];
      const boundary = await createBrowserBoundary(browser, async (url) => {
        visited.push(url);
        return resource(url, "", "text/html", 302, "https://10.0.0.1/private");
      });
      try {
        const page = await boundary.context.newPage();
        const navigation = page
          .goto("https://fixture.example/", {
            waitUntil: "commit",
            timeout: 3000,
          })
          .catch(() => undefined);
        await expect.poll(() => visited.length).toBe(1);
        expect(visited).toEqual(["https://fixture.example/"]);
        await expect
          .poll(() => boundary.metrics.blocked)
          .toBeGreaterThanOrEqual(1);
        await page.close();
        await navigation;
      } finally {
        await boundary.context.close();
      }
    } finally {
      await browser.close();
    }
  }, 10_000);
});
