import type { IncomingHttpHeaders } from "node:http";
import { describe, expect, it } from "vitest";
import {
  collectLimited,
  connectionLookup,
  createPinnedLookup,
  fetchPublic,
  type FetchedResource,
} from "../src/safe-http.js";
import { FETCH_LIMITS } from "../src/url-policy.js";

function result(
  url: URL,
  status: number,
  headers: IncomingHttpHeaders = {},
): FetchedResource {
  return { url: url.href, status, headers, body: Buffer.from("fixture") };
}

describe("safe HTTP boundary", () => {
  it("returns the pinned IP in Node's all-address lookup form", async () => {
    const pinnedLookup = createPinnedLookup(async () => ["8.8.8.8"]);
    const result = await new Promise<unknown>((resolve, reject) => {
      pinnedLookup("example.com", { all: true }, (error, addresses) => {
        if (error) reject(error);
        else resolve(addresses);
      });
    });
    expect(result).toEqual([{ address: "8.8.8.8", family: 4 }]);
  });

  it("rejects a direct private URL before any request", async () => {
    let called = false;
    await expect(
      fetchPublic(
        "https://169.254.169.254/",
        async () => ["8.8.8.8"],
        async (url) => {
          called = true;
          return result(url, 200);
        },
      ),
    ).rejects.toThrow("non-public IP");
    expect(called).toBe(false);
  });

  it("rejects a streamed body larger than one MiB", async () => {
    async function* chunks() {
      yield Buffer.alloc(FETCH_LIMITS.maxResponseBytes);
      yield Buffer.from("x");
    }
    await expect(collectLimited(chunks())).rejects.toThrow("byte limit");
  });

  it("applies a caller's larger limit and passes it to every hop", async () => {
    async function* chunks() {
      yield Buffer.alloc(FETCH_LIMITS.maxResponseBytes);
      yield Buffer.from("x");
    }
    const limit = FETCH_LIMITS.maxResponseBytes * 2;
    await expect(collectLimited(chunks(), limit)).resolves.toHaveLength(
      FETCH_LIMITS.maxResponseBytes + 1,
    );
    const limits: (number | undefined)[] = [];
    await fetchPublic(
      "https://example.com/app.js",
      async () => ["8.8.8.8"],
      async (url, _resolve, _signal, maxBytes) => {
        limits.push(maxBytes);
        return url.pathname === "/app.js"
          ? result(url, 302, { location: "/bundle.js" })
          : result(url, 200);
      },
      undefined,
      limit,
    );
    expect(limits).toEqual([limit, limit]);
  });

  it("checks DNS on each connection and rejects a changed private answer", async () => {
    let calls = 0;
    const resolve = async () => (++calls === 1 ? ["8.8.8.8"] : ["127.0.0.1"]);
    await expect(connectionLookup("example.com", resolve)).resolves.toEqual({
      address: "8.8.8.8",
      family: 4,
    });
    await expect(connectionLookup("example.com", resolve)).rejects.toThrow(
      "non-public",
    );
  });

  it("validates each redirect before sending the next request", async () => {
    const visited: string[] = [];
    const send = async (url: URL) => {
      visited.push(url.href);
      return result(url, 302, { location: "https://127.0.0.1/private" });
    };
    await expect(
      fetchPublic("https://example.com/jobs", async () => ["8.8.8.8"], send),
    ).rejects.toThrow("non-public IP");
    expect(visited).toEqual(["https://example.com/jobs"]);
  });

  it("rejects a redirect to an insecure scheme", async () => {
    const send = async (url: URL) =>
      result(url, 302, { location: "http://example.com/private" });
    await expect(
      fetchPublic("https://example.com/jobs", async () => ["8.8.8.8"], send),
    ).rejects.toThrow("HTTPS");
  });

  it("stops after the redirect cap", async () => {
    let calls = 0;
    const send = async (url: URL) => {
      calls += 1;
      return result(url, 302, { location: `/next-${calls}` });
    };
    await expect(
      fetchPublic("https://example.com/jobs", async () => ["8.8.8.8"], send),
    ).rejects.toThrow("redirect limit");
    expect(calls).toBe(4);
  });

  it("returns the final public response after a safe redirect", async () => {
    const send = async (url: URL) =>
      url.pathname === "/old"
        ? result(url, 301, { location: "/jobs" })
        : result(url, 200, { "content-type": "text/html" });
    const response = await fetchPublic(
      "https://example.com/old",
      async () => ["8.8.8.8"],
      send,
    );
    expect(response.url).toBe("https://example.com/jobs");
    expect(response.status).toBe(200);
  });

  it("checks site authorization before each redirect target", async () => {
    const visited: string[] = [];
    const send = async (url: URL) => {
      visited.push(url.href);
      return result(url, 302, { location: "https://other.example/jobs" });
    };
    await expect(
      fetchPublic(
        "https://example.com/jobs",
        async () => ["8.8.8.8"],
        send,
        async (url) => {
          if (url.hostname === "other.example") throw new Error("terms denied");
        },
      ),
    ).rejects.toThrow("terms denied");
    expect(visited).toEqual(["https://example.com/jobs"]);
  });
});
