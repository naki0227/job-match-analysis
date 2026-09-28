import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { expect, test, type Page } from "@playwright/test";

const fixture = (name: string) =>
  readFile(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8",
  );
const minimumTextChars = 100;
const maximumHtmlBytes = 1024 * 1024;

function meaningfulText(html: string): string {
  const document = new JSDOM(html).window.document;
  return document.querySelector("article[data-job]")?.textContent?.trim() ?? "";
}

async function readLimited(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error("empty response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumHtmlBytes) throw new Error("HTML byte limit exceeded");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function compare(url: string, page: Page) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const html = await readLimited(response);
  const httpText = meaningfulText(html);
  if (httpText.length >= minimumTextChars) {
    return { source: "http", text: httpText, browserAttempts: 0 };
  }
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10_000 });
  await page.locator("article[data-job]").waitFor({ timeout: 5000 });
  const browserText =
    (await page.locator("article[data-job]").textContent())?.trim() ?? "";
  if (browserText.length < minimumTextChars)
    throw new Error("insufficient content");
  return { source: "browser", text: browserText, browserAttempts: 1 };
}

let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  const [staticHtml, jsHtml, script] = await Promise.all([
    fixture("static-job.html"),
    fixture("js-job.html"),
    fixture("job.js"),
  ]);
  server = createServer((request, response) => {
    const path = request.url;
    if (path === "/static") response.end(staticHtml);
    else if (path === "/js") response.end(jsHtml);
    else if (path === "/job.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(script);
    } else if (path === "/large")
      response.end(
        "<article data-job>" + "a".repeat(maximumHtmlBytes + 1) + "</article>",
      );
    else {
      response.statusCode = 503;
      response.end("unavailable");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture server address unavailable");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});

test("static HTML is sufficient without browser navigation", async ({
  page,
}) => {
  const result = await compare(`${baseUrl}/static`, page);
  expect(result.source).toBe("http");
  expect(result.text.length).toBeGreaterThanOrEqual(minimumTextChars);
  expect(result.browserAttempts).toBe(0);
  expect(page.url()).toBe("about:blank");
});

test("JS-rendered content falls back to browser once", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const result = await compare(`${baseUrl}/js`, page);
  expect(result.source).toBe("browser");
  expect(result.browserAttempts).toBe(1);
  expect(requests.filter((url) => url.endsWith("/js"))).toHaveLength(1);
  expect(requests.some((url) => url.endsWith("/job.js"))).toBe(true);
});

test("oversized HTML stops before browser fallback", async ({ page }) => {
  await expect(compare(`${baseUrl}/large`, page)).rejects.toThrow(
    "HTML byte limit exceeded",
  );
  expect(page.url()).toBe("about:blank");
});

test("failed HTTP fetch does not open browser", async ({ page }) => {
  await expect(compare(`${baseUrl}/unavailable`, page)).rejects.toThrow(
    "HTTP 503",
  );
  expect(page.url()).toBe("about:blank");
});
