import { describe, expect, it } from "vitest";
import {
  legalAcknowledgementStatusSchema,
  recordLegalAcknowledgementsSchema,
} from "../src/legal.js";

const id = "46100000-0000-4000-8000-000000000001";

describe("legal contracts", () => {
  it("records only document IDs; user and action never come from the client", () => {
    expect(
      recordLegalAcknowledgementsSchema.parse({
        termsDocumentId: id,
        privacyPolicyDocumentId: id,
      }),
    ).toEqual({ termsDocumentId: id, privacyPolicyDocumentId: id });
    for (const extra of [{ userId: id }, { action: "accepted" }]) {
      expect(
        recordLegalAcknowledgementsSchema.safeParse({
          termsDocumentId: id,
          privacyPolicyDocumentId: id,
          ...extra,
        }).success,
      ).toBe(false);
    }
    expect(
      recordLegalAcknowledgementsSchema.safeParse({ termsDocumentId: id })
        .success,
    ).toBe(false);
  });

  it("carries the version-pinned status and history", () => {
    const requirement = { documentId: id, version: "1.0", recordedAt: null };
    expect(
      legalAcknowledgementStatusSchema.parse({
        complete: false,
        terms: requirement,
        privacyPolicy: { ...requirement, recordedAt: "2026-10-01T00:00:00Z" },
        history: [
          {
            documentType: "privacy_policy",
            version: "1.0",
            action: "acknowledged",
            recordedAt: "2026-10-01T00:00:00Z",
          },
        ],
      }).complete,
    ).toBe(false);
  });
});
