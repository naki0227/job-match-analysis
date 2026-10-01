import {
  currentLegalDocumentsSchema,
  legalAcknowledgementStatusSchema,
  type CurrentLegalDocuments,
  type LegalAcknowledgementStatus,
} from "@job-match/contracts";

export type LegalApiErrorKind =
  "unauthorized" | "outdated" | "documents_unavailable" | "unavailable";

export class LegalApiError extends Error {
  readonly kind: LegalApiErrorKind;

  constructor(kind: LegalApiErrorKind) {
    super(kind);
    this.name = "LegalApiError";
    this.kind = kind;
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (value: unknown) => T,
  fetcher: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(path, init);
  } catch {
    throw new LegalApiError("unavailable");
  }
  if (response.status === 401 || response.status === 403)
    throw new LegalApiError("unauthorized");
  if (response.status === 409) throw new LegalApiError("outdated");
  if (!response.ok) {
    const code = await response
      .json()
      .then((body: { code?: unknown }) => body.code)
      .catch(() => null);
    throw new LegalApiError(
      code === "legal_documents_unavailable"
        ? "documents_unavailable"
        : "unavailable",
    );
  }
  try {
    return parse(await response.json());
  } catch {
    throw new LegalApiError("unavailable");
  }
}

/** The published, effective versions; their text comes from the database. */
export function readCurrentLegalDocuments(
  fetcher: typeof fetch = fetch,
): Promise<CurrentLegalDocuments> {
  return request(
    "/api/v1/legal-documents/current",
    {},
    (value) => currentLegalDocumentsSchema.parse(value),
    fetcher,
  );
}

export function readLegalStatus(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<LegalAcknowledgementStatus> {
  return request(
    "/api/v1/me/legal-acknowledgements",
    { headers: { Authorization: `Bearer ${accessToken}` } },
    (value) => legalAcknowledgementStatusSchema.parse(value),
    fetcher,
  );
}

/** Records the shown versions for the signed-in user (server decides who). */
export function recordLegalAcknowledgements(
  accessToken: string,
  documents: { termsDocumentId: string; privacyPolicyDocumentId: string },
  fetcher: typeof fetch = fetch,
): Promise<LegalAcknowledgementStatus> {
  return request(
    "/api/v1/me/legal-acknowledgements",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(documents),
    },
    (value) => legalAcknowledgementStatusSchema.parse(value),
    fetcher,
  );
}
