import { lookup } from "node:dns/promises";
import { request, type RequestOptions } from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { isIP } from "node:net";
import {
  FETCH_LIMITS,
  parsePublicUrl,
  resolvePublicAddress,
  UnsafeTargetError,
  type ResolveAddresses,
} from "./url-policy.js";

export interface FetchedResource {
  readonly url: string;
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

export const systemResolver: ResolveAddresses = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

export async function connectionLookup(
  hostname: string,
  resolve: ResolveAddresses,
): Promise<{ address: string; family: 4 | 6 }> {
  return resolvePublicAddress(hostname, resolve);
}

export function createPinnedLookup(
  resolve: ResolveAddresses,
): NonNullable<RequestOptions["lookup"]> {
  return (hostname, lookupOptions, callback) => {
    void connectionLookup(hostname, resolve).then(
      ({ address, family }) => {
        if (lookupOptions.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
      (error: unknown) => callback(error as Error, []),
    );
  };
}

export type RequestOnce = (
  url: URL,
  resolve: ResolveAddresses,
  signal: AbortSignal,
) => Promise<FetchedResource>;

export async function collectLimited(
  chunks: AsyncIterable<Buffer>,
): Promise<Buffer> {
  const received: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of chunks) {
    bytes += chunk.byteLength;
    if (bytes > FETCH_LIMITS.maxResponseBytes) {
      throw new UnsafeTargetError("response byte limit exceeded");
    }
    received.push(chunk);
  }
  return Buffer.concat(received);
}

export const requestOnce: RequestOnce = (url, resolve, signal) =>
  new Promise((fulfill, reject) => {
    const options: RequestOptions = {
      agent: false,
      signal,
      headers: {
        "accept-encoding": "identity",
        "user-agent": "JobMatchCrawler/1.0",
      },
      lookup: createPinnedLookup(resolve),
    };
    const outgoing = request(url, options, (incoming) => {
      const encoding = incoming.headers["content-encoding"];
      if (encoding && encoding !== "identity") {
        outgoing.destroy();
        reject(new UnsafeTargetError("compressed response is not allowed"));
        return;
      }
      const declaredSize = Number(incoming.headers["content-length"]);
      if (
        Number.isFinite(declaredSize) &&
        declaredSize > FETCH_LIMITS.maxResponseBytes
      ) {
        outgoing.destroy();
        reject(new UnsafeTargetError("response byte limit exceeded"));
        return;
      }
      void collectLimited(incoming).then(
        (body) =>
          fulfill({
            url: url.href,
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body,
          }),
        (error: unknown) => {
          outgoing.destroy();
          reject(error);
        },
      );
    });
    outgoing.on("error", reject);
    outgoing.end();
  });

export async function fetchPublicOnce(
  input: string,
  signal: AbortSignal = AbortSignal.timeout(FETCH_LIMITS.timeoutMs),
  resolve: ResolveAddresses = systemResolver,
  send: RequestOnce = requestOnce,
): Promise<FetchedResource> {
  const url = parsePublicUrl(input);
  // Literal IPs skip Node's lookup callback. Validate them on every hop.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) await resolvePublicAddress(host, async () => [host]);
  return send(url, resolve, signal);
}

export async function fetchPublic(
  input: string,
  resolve: ResolveAddresses = systemResolver,
  send: RequestOnce = requestOnce,
  authorize?: (url: URL) => Promise<void>,
): Promise<FetchedResource> {
  let url = parsePublicUrl(input);
  const signal = AbortSignal.timeout(FETCH_LIMITS.timeoutMs);
  for (
    let redirects = 0;
    redirects <= FETCH_LIMITS.maxRedirects;
    redirects += 1
  ) {
    await authorize?.(url);
    const result = await fetchPublicOnce(url.href, signal, resolve, send);
    const location = result.headers.location;
    if (result.status < 300 || result.status > 399 || !location) return result;
    if (redirects === FETCH_LIMITS.maxRedirects) {
      throw new UnsafeTargetError("redirect limit exceeded");
    }
    url = parsePublicUrl(new URL(location, url).href);
  }
  throw new UnsafeTargetError("redirect limit exceeded");
}
