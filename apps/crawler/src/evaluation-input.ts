import { createHash } from "node:crypto";
import type { EvidenceCandidate } from "./decision-engine.js";
import { CANDIDATE_SELECTOR_VERSION } from "./evidence-candidates.js";
import type { ExtractedSourceDocument } from "./source-extractor.js";

export function sourceSetHash(args: {
  documents: readonly ExtractedSourceDocument[];
  candidates: readonly EvidenceCandidate[];
  scope: "company" | "job";
}): string {
  if (args.documents.length === 0)
    throw new RangeError("evaluation requires a source document");
  for (const candidate of args.candidates) {
    const document = args.documents[candidate.documentIndex];
    if (
      !document ||
      candidate.scope !== args.scope ||
      !document.fragments.some(
        (fragment) =>
          fragment.scope === args.scope &&
          fragment.text.includes(candidate.excerpt),
      )
    ) {
      throw new RangeError("evidence candidate is not in the source document");
    }
  }
  return createHash("sha256")
    .update(
      JSON.stringify({
        selector: CANDIDATE_SELECTOR_VERSION,
        scope: args.scope,
        documents: args.documents.map((document) => ({
          url: document.url,
          contentHash: document.contentHash,
          fetchedAt: document.fetchedAt,
          extractorVersion: document.extractorVersion,
        })),
        candidates: [...args.candidates]
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map((candidate) => ({
            id: candidate.id,
            axisKey: candidate.axisKey,
            documentIndex: candidate.documentIndex,
            excerpt: candidate.excerpt,
            locator: candidate.locator,
          })),
      }),
    )
    .digest("hex");
}
