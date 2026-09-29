import { matchReportSchema, type MatchReport } from "@job-match/contracts";

export type MatchApiErrorKind =
  | "profile_required"
  | "not_comparable"
  | "not_found"
  | "unauthorized"
  | "unavailable";

export class MatchApiError extends Error {
  readonly kind: MatchApiErrorKind;

  constructor(kind: MatchApiErrorKind) {
    super(kind);
    this.name = "MatchApiError";
    this.kind = kind;
  }
}

function classify(status: number): MatchApiErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409) return "profile_required";
  if (status === 422) return "not_comparable";
  return "unavailable";
}

/**
 * Compares the caller's latest profile with a job evaluation. The server
 * reuses a stored match for the same inputs, so repeating this is safe.
 */
export async function requestMatch(
  accessToken: string,
  evaluationId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<MatchReport> {
  let response: Response;
  try {
    response = await fetcher("/api/v1/matches", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ evaluationId }),
      signal,
    });
  } catch {
    throw new MatchApiError("unavailable");
  }
  if (!response.ok) throw new MatchApiError(classify(response.status));
  try {
    const report = matchReportSchema.parse(await response.json());
    if (report.job.evaluationId !== evaluationId) throw new Error("mismatch");
    return report;
  } catch {
    throw new MatchApiError("unavailable");
  }
}
