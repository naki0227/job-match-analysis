/**
 * Fetches a public ATS listing page with a closed boundary: https only, the
 * exact allowlisted host, no redirects, a size and time limit, and the
 * host's robots.txt honoured. The URL is always built by an adapter from a
 * validated slug, never taken from user input, so it cannot reach internal
 * addresses (ADR-045).
 */
export type ListingFetch = (url: URL) => Promise<string | null>;

const MAX_BYTES = 1_000_000;

async function readLimited(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Longest matching rule wins; Allow wins a tie (RFC 9309). */
export function robotsAllows(robots: string, path: string): boolean {
  let applies = false;
  let best: { length: number; allow: boolean } | null = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const field = key?.trim().toLowerCase();
    if (field === "user-agent") applies = value === "*";
    else if (applies && (field === "allow" || field === "disallow") && value) {
      if (!path.startsWith(value)) continue;
      const allow = field === "allow";
      if (
        !best ||
        value.length > best.length ||
        (value.length === best.length && allow)
      )
        best = { length: value.length, allow };
    }
  }
  return best?.allow ?? true;
}

export function createListingFetch(
  allowedHosts: ReadonlySet<string>,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
): ListingFetch {
  const get = async (url: URL) => {
    const response = await fetcher(url, {
      redirect: "manual",
      headers: { Accept: "text/html,text/plain" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.status === 200 ? readLimited(response) : null;
  };
  return async (url) => {
    if (
      url.protocol !== "https:" ||
      !allowedHosts.has(url.hostname) ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== ""
    )
      return null;
    const robots = await get(new URL("/robots.txt", url.origin));
    if (robots !== null && !robotsAllows(robots, url.pathname)) return null;
    return get(url);
  };
}
