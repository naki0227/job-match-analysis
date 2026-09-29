import {
  careerProfileResponseSchema,
  type CareerProfileResponse,
  type CommitCareerProfileRequest,
} from "@job-match/contracts";

export class CareerProfileApiError extends Error {
  readonly kind: "unauthorized" | "conflict" | "unavailable";

  constructor(kind: "unauthorized" | "conflict" | "unavailable") {
    super(kind);
    this.kind = kind;
  }
}

export async function loadCareerProfile(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<CareerProfileResponse | null> {
  let response: Response;
  try {
    response = await fetcher("/api/v1/me/career-profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new CareerProfileApiError("unavailable");
  }
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw new CareerProfileApiError("unauthorized");
  }
  if (!response.ok) throw new CareerProfileApiError("unavailable");
  try {
    return careerProfileResponseSchema.parse(await response.json());
  } catch {
    throw new CareerProfileApiError("unavailable");
  }
}

export async function saveCareerProfile(
  accessToken: string,
  request: CommitCareerProfileRequest,
  fetcher: typeof fetch = fetch,
): Promise<CareerProfileResponse> {
  let response: Response;
  try {
    response = await fetcher("/api/v1/me/career-profile", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  } catch {
    throw new CareerProfileApiError("unavailable");
  }
  if (response.status === 401 || response.status === 403) {
    throw new CareerProfileApiError("unauthorized");
  }
  if (response.status === 409) throw new CareerProfileApiError("conflict");
  if (!response.ok) throw new CareerProfileApiError("unavailable");
  try {
    return careerProfileResponseSchema.parse(await response.json());
  } catch {
    throw new CareerProfileApiError("unavailable");
  }
}
