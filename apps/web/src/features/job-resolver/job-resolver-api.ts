import {
  jobSearchResponseSchema,
  type JobSearchRequest,
  type JobSearchResponse,
} from "@job-match/contracts";

export type JobSearchErrorKind =
  "invalid" | "unauthorized" | "rate_limited" | "unavailable";

export class JobSearchError extends Error {
  readonly kind: JobSearchErrorKind;

  constructor(kind: JobSearchErrorKind) {
    super(kind);
    this.name = "JobSearchError";
    this.kind = kind;
  }
}

async function parseResponse(response: Response): Promise<JobSearchResponse> {
  if (response.status === 400) throw new JobSearchError("invalid");
  if (response.status === 401 || response.status === 403)
    throw new JobSearchError("unauthorized");
  if (response.status === 429) throw new JobSearchError("rate_limited");
  if (!response.ok) throw new JobSearchError("unavailable");
  try {
    return jobSearchResponseSchema.parse(await response.json());
  } catch {
    throw new JobSearchError("unavailable");
  }
}

/** Polls a running web discovery; the answer has the same shape as a search. */
export async function readJobDiscovery(
  accessToken: string,
  discoveryId: string,
  fetcher: typeof fetch = fetch,
): Promise<JobSearchResponse> {
  let response: Response;
  try {
    response = await fetcher(
      `/api/v1/job-resolver/discoveries/${encodeURIComponent(discoveryId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch {
    throw new JobSearchError("unavailable");
  }
  return parseResponse(response);
}

/** Finds the posting for a company and role; it does not start analysis. */
export async function searchJob(
  accessToken: string,
  request: JobSearchRequest,
  fetcher: typeof fetch = fetch,
): Promise<JobSearchResponse> {
  let response: Response;
  try {
    response = await fetcher("/api/v1/job-resolver/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  } catch {
    throw new JobSearchError("unavailable");
  }
  return parseResponse(response);
}
