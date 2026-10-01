import { z } from "zod";

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });

/** A published, effective legal document version (body from the DB). */
export const legalDocumentSchema = z.strictObject({
  id: uuid,
  version: z.string().min(1).max(80),
  bodyMarkdown: z.string().min(1),
  publishedAt: timestamp,
  effectiveAt: timestamp,
});

/** GET /api/v1/legal-documents/current (ADR-046). */
export const currentLegalDocumentsSchema = z.strictObject({
  terms: legalDocumentSchema,
  privacyPolicy: legalDocumentSchema,
});

const requirementSchema = z.strictObject({
  documentId: uuid,
  version: z.string().min(1).max(80),
  /** When this user recorded the required action for this exact version. */
  recordedAt: timestamp.nullable(),
});

export const legalHistoryItemSchema = z.strictObject({
  documentType: z.enum(["terms", "privacy_policy"]),
  version: z.string().min(1).max(80),
  action: z.enum(["accepted", "acknowledged"]),
  recordedAt: timestamp,
});

/** GET and POST /api/v1/me/legal-acknowledgements. */
export const legalAcknowledgementStatusSchema = z.strictObject({
  /** True only when both current versions are recorded. */
  complete: z.boolean(),
  terms: requirementSchema,
  privacyPolicy: requirementSchema,
  history: z.array(legalHistoryItemSchema).max(100),
});

/**
 * The versions the user was shown. The action per document is fixed by the
 * server (terms: accepted, privacy policy: acknowledged).
 */
export const recordLegalAcknowledgementsSchema = z.strictObject({
  termsDocumentId: uuid,
  privacyPolicyDocumentId: uuid,
});

export type LegalDocument = z.infer<typeof legalDocumentSchema>;
export type CurrentLegalDocuments = z.infer<typeof currentLegalDocumentsSchema>;
export type LegalHistoryItem = z.infer<typeof legalHistoryItemSchema>;
export type LegalAcknowledgementStatus = z.infer<
  typeof legalAcknowledgementStatusSchema
>;
export type RecordLegalAcknowledgements = z.infer<
  typeof recordLegalAcknowledgementsSchema
>;
