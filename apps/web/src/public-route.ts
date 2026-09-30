/** Token of a public share page path (/s/<token>), or null for other paths. */
export function publicShareToken(pathname: string): string | null {
  return /^\/s\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname)?.[1] ?? null;
}
