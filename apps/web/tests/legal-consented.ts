import { sampleLegalDocuments } from "../src/dev/fixtures";

/**
 * Wraps a fetch stub for tests of screens behind the legal gate: the signed-in
 * user has already confirmed the current versions. Other requests go to
 * `inner` unchanged, so its call counts stay meaningful.
 */
export function consented(inner: (...args: never[]) => unknown): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/v1/me/legal-acknowledgements") {
      const at = "2026-10-01T00:00:00.000Z";
      return new Response(
        JSON.stringify({
          complete: true,
          terms: {
            documentId: sampleLegalDocuments.terms.id,
            version: "1.0",
            recordedAt: at,
          },
          privacyPolicy: {
            documentId: sampleLegalDocuments.privacyPolicy.id,
            version: "1.0",
            recordedAt: at,
          },
          history: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return (inner as unknown as typeof fetch)(input, init);
  }) as typeof fetch;
}
