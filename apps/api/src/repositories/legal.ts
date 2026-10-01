import {
  type CurrentLegalDocuments,
  type LegalAcknowledgementStatus,
} from "@job-match/contracts";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export type LegalRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** No published, effective terms or privacy policy: fail closed. */
export class LegalDocumentsUnavailableError extends Error {
  constructor(readonly missing: readonly string[]) {
    super("Legal documents are unavailable");
    this.name = "LegalDocumentsUnavailableError";
  }
}

/** The client acknowledged a version that is no longer (or not yet) current. */
export class LegalDocumentOutdatedError extends Error {
  constructor() {
    super("Legal document is not current");
    this.name = "LegalDocumentOutdatedError";
  }
}

export class LegalStoreError extends Error {
  constructor() {
    super("Legal storage is unavailable");
    this.name = "LegalStoreError";
  }
}

const timestamp = z.string().transform((value, context) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    context.addIssue({ code: "custom", message: "invalid timestamp" });
    return z.NEVER;
  }
  return date.toISOString();
});
const documentType = z.enum(["terms", "privacy_policy"]);

const documentsSchema = z.array(
  z.object({
    id: z.uuid(),
    document_type: documentType,
    version: z.string().min(1),
    body_markdown: z.string().min(1),
    published_at: timestamp,
    effective_at: timestamp,
  }),
);
const statusSchema = z.array(
  z.object({
    document_type: documentType,
    legal_document_id: z.uuid(),
    version: z.string().min(1),
    recorded_at: timestamp.nullable(),
  }),
);
const historySchema = z.array(
  z.object({
    document_type: documentType,
    version: z.string().min(1),
    action: z.enum(["accepted", "acknowledged"]),
    recorded_at: timestamp,
  }),
);

function missingTypes(rows: readonly { document_type: string }[]): string[] {
  return ["terms", "privacy_policy"].filter(
    (type) => !rows.some((row) => row.document_type === type),
  );
}

async function call(
  rpc: LegalRpc,
  name: string,
  args: Record<string, unknown>,
) {
  try {
    return await rpc(name, args);
  } catch (error) {
    if (error instanceof LegalDocumentOutdatedError) throw error;
    if (error instanceof LegalDocumentsUnavailableError) throw error;
    throw new LegalStoreError();
  }
}

export function createLegalRepository(rpc: LegalRpc) {
  async function current(): Promise<CurrentLegalDocuments> {
    const parsed = documentsSchema.safeParse(
      await call(rpc, "current_legal_documents", {}),
    );
    if (!parsed.success) throw new LegalStoreError();
    const missing = missingTypes(parsed.data);
    if (missing.length) throw new LegalDocumentsUnavailableError(missing);
    const view = (type: "terms" | "privacy_policy") => {
      const row = parsed.data.find((item) => item.document_type === type)!;
      return {
        id: row.id,
        version: row.version,
        bodyMarkdown: row.body_markdown,
        publishedAt: row.published_at,
        effectiveAt: row.effective_at,
      };
    };
    return { terms: view("terms"), privacyPolicy: view("privacy_policy") };
  }

  async function status(userId: string): Promise<LegalAcknowledgementStatus> {
    const rows = statusSchema.safeParse(
      await call(rpc, "legal_acknowledgement_status", { p_user_id: userId }),
    );
    const history = historySchema.safeParse(
      await call(rpc, "list_legal_acknowledgements", { p_user_id: userId }),
    );
    if (!rows.success || !history.success) throw new LegalStoreError();
    const missing = missingTypes(rows.data);
    if (missing.length) throw new LegalDocumentsUnavailableError(missing);
    const requirement = (type: "terms" | "privacy_policy") => {
      const row = rows.data.find((item) => item.document_type === type)!;
      return {
        documentId: row.legal_document_id,
        version: row.version,
        recordedAt: row.recorded_at,
      };
    };
    const terms = requirement("terms");
    const privacyPolicy = requirement("privacy_policy");
    return {
      complete: terms.recordedAt !== null && privacyPolicy.recordedAt !== null,
      terms,
      privacyPolicy,
      history: history.data.map((item) => ({
        documentType: item.document_type,
        version: item.version,
        action: item.action,
        recordedAt: item.recorded_at,
      })),
    };
  }

  async function record(
    userId: string,
    termsDocumentId: string,
    privacyPolicyDocumentId: string,
  ): Promise<void> {
    await call(rpc, "record_legal_acknowledgements", {
      p_user_id: userId,
      p_terms_document_id: termsDocumentId,
      p_privacy_document_id: privacyPolicyDocumentId,
    });
  }

  return { current, status, record };
}

export type LegalRepository = ReturnType<typeof createLegalRepository>;

export function createSupabaseLegalRepository(): LegalRepository {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new LegalStoreError();
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createLegalRepository(async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error?.code === "P0409") throw new LegalDocumentOutdatedError();
    if (error?.code === "P0503") throw new LegalDocumentsUnavailableError([]);
    if (error) throw new LegalStoreError();
    return data;
  });
}
