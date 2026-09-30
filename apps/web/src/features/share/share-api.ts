import {
  matchShareSchema,
  publicShareSchema,
  type MatchShare,
  type PublicShare,
} from "@job-match/contracts";

export type ShareApiErrorKind = "unauthorized" | "not_found" | "unavailable";

export class ShareApiError extends Error {
  readonly kind: ShareApiErrorKind;

  constructor(kind: ShareApiErrorKind) {
    super(kind);
    this.name = "ShareApiError";
    this.kind = kind;
  }
}

async function send(
  input: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(input, init);
  } catch {
    throw new ShareApiError("unavailable");
  }
  if (response.status === 401 || response.status === 403) {
    throw new ShareApiError("unauthorized");
  }
  if (response.status === 404) throw new ShareApiError("not_found");
  if (!response.ok) throw new ShareApiError("unavailable");
  return response;
}

async function parse<T>(response: Response, parser: (v: unknown) => T) {
  try {
    return parser(await response.json());
  } catch {
    throw new ShareApiError("unavailable");
  }
}

const matchPath = (matchResultId: string) =>
  `/api/v1/me/matches/${encodeURIComponent(matchResultId)}/share`;

/** The caller's live link for a Match, or null when none is published. */
export async function readShareLink(
  accessToken: string,
  matchResultId: string,
  fetcher: typeof fetch = fetch,
): Promise<MatchShare | null> {
  try {
    const response = await send(
      matchPath(matchResultId),
      { headers: { Authorization: `Bearer ${accessToken}` } },
      fetcher,
    );
    return parse(response, (value) => matchShareSchema.parse(value));
  } catch (error) {
    if (error instanceof ShareApiError && error.kind === "not_found") {
      return null;
    }
    throw error;
  }
}

export async function createShareLink(
  accessToken: string,
  matchResultId: string,
  fetcher: typeof fetch = fetch,
): Promise<MatchShare> {
  const response = await send(
    matchPath(matchResultId),
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
    fetcher,
  );
  return parse(response, (value) => matchShareSchema.parse(value));
}

export async function revokeShareLink(
  accessToken: string,
  shareId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await send(
    `/api/v1/me/shares/${encodeURIComponent(shareId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
    fetcher,
  );
}

/** Anonymous read of a live public share. */
export async function readPublicShare(
  token: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PublicShare> {
  const response = await send(
    `/api/v1/public/shares/${encodeURIComponent(token)}`,
    { signal },
    fetcher,
  );
  return parse(response, (value) => publicShareSchema.parse(value));
}
