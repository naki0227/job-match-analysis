import { createHash } from "node:crypto";
import { CONTEXT_SELECTOR_VERSION } from "./context-fragments.js";
import type { ContextFragment } from "./decision-engine.js";
import type { ExtractedSourceDocument } from "./source-extractor.js";

export function sourceSetHash(args: {
  documents: readonly ExtractedSourceDocument[];
  fragments: readonly ContextFragment[];
  scope: "company" | "job";
}): string {
  if (args.documents.length === 0)
    throw new RangeError("evaluation requires a source document");
  for (const item of args.fragments) {
    const document = args.documents[item.documentIndex];
    if (
      !document ||
      item.scope !== args.scope ||
      !document.fragments.some(
        (fragment) =>
          fragment.scope === args.scope && fragment.text.includes(item.text),
      )
    ) {
      throw new RangeError("context fragment is not in the source document");
    }
  }
  return createHash("sha256")
    .update(
      JSON.stringify({
        selector: CONTEXT_SELECTOR_VERSION,
        scope: args.scope,
        documents: args.documents.map((document) => ({
          url: document.url,
          contentHash: document.contentHash,
          fetchedAt: document.fetchedAt,
          extractorVersion: document.extractorVersion,
        })),
        fragments: [...args.fragments]
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map((item) => ({
            id: item.id,
            documentIndex: item.documentIndex,
            text: item.text,
            locator: item.locator,
          })),
      }),
    )
    .digest("hex");
}
