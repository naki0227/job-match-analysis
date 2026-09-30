import {
  analysisJobResponseSchema,
  analysisPostResponseSchema,
  type AnalysisJobResponse,
  type AnalysisPostResponse,
} from "@job-match/contracts";

export type AnalysisApiErrorKind =
  | "invalid_url"
  | "unauthorized"
  | "not_found"
  | "quota_exceeded"
  | "unavailable";

export class AnalysisApiError extends Error {
  readonly kind: AnalysisApiErrorKind;

  constructor(kind: AnalysisApiErrorKind) {
    super(kind);
    this.name = "AnalysisApiError";
    this.kind = kind;
  }
}

async function send(
  input: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<Response> {
  try {
    return await fetcher(input, init);
  } catch {
    throw new AnalysisApiError("unavailable");
  }
}

function classify(response: Response): AnalysisApiError | null {
  if (response.status === 400) return new AnalysisApiError("invalid_url");
  if (response.status === 401 || response.status === 403) {
    return new AnalysisApiError("unauthorized");
  }
  if (response.status === 404) return new AnalysisApiError("not_found");
  if (response.status === 429) return new AnalysisApiError("quota_exceeded");
  if (!response.ok) return new AnalysisApiError("unavailable");
  return null;
}

async function parseBody<T>(
  response: Response,
  parse: (value: unknown) => T,
): Promise<T> {
  try {
    return parse(await response.json());
  } catch {
    throw new AnalysisApiError("unavailable");
  }
}

/** Joins or reuses the shared analysis for a public job URL. */
export async function requestAnalysis(
  accessToken: string,
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<AnalysisPostResponse> {
  const response = await send(
    "/api/v1/analyses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    },
    fetcher,
  );
  const error = classify(response);
  if (error) throw error;
  return parseBody(response, (value) =>
    analysisPostResponseSchema.parse(value),
  );
}

/**
 * A poll that never settles (for example a request cut off while a mobile
 * browser suspended the page) would block every later poll, so each read
 * gives up after this long and counts as a temporary outage.
 */
export const JOB_READ_TIMEOUT_MS = 10_000;

/** Reads only the shared, non-personal state of an analysis job. */
export async function readAnalysisJob(
  accessToken: string,
  jobId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  timeoutMs = JOB_READ_TIMEOUT_MS,
): Promise<AnalysisJobResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  let response: Response;
  try {
    response = await send(
      `/api/v1/analyses/${encodeURIComponent(jobId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      },
      fetcher,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  const error = classify(response);
  if (error) throw error;
  const job = await parseBody(response, (value) =>
    analysisJobResponseSchema.parse(value),
  );
  if (job.jobId !== jobId) throw new AnalysisApiError("unavailable");
  return job;
}
