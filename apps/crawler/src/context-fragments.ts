import { createHash } from "node:crypto";
import type { ContextFragment } from "./decision-engine.js";
import type { ExtractedSourceDocument } from "./source-extractor.js";

/**
 * Part of every evaluator version and source set hash: changing how the
 * context is built must never reuse evaluations made from another context.
 */
export const CONTEXT_SELECTOR_VERSION = "context-fragments-v4";

export type ContextLimits = {
  /** Longest fragment, and so the longest quote stored as evidence. */
  maxFragmentChars: number;
};

export type ContextStats = {
  /** Usable fragments found in the extracted public source. */
  available: number;
  /** Fragments sent to the evaluator. No application-level selection occurs. */
  sent: number;
  sentChars: number;
};

function sentences(text: string): string[] {
  return text
    .split(/(?<=[。！？])|(?<=[.!?])\s+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Split only so evidence can point to a bounded exact substring. Every
 * non-whitespace character from the extracted fragment is retained.
 */
function pieces(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return text.trim() ? [text.trim()] : [];
  return sentences(text).flatMap((sentence) => {
    const result: string[] = [];
    for (let offset = 0; offset < sentence.length; offset += maxChars) {
      const piece = sentence.slice(offset, offset + maxChars).trim();
      if (piece) result.push(piece);
    }
    return result;
  });
}

function assertLimits(limits: ContextLimits): void {
  if (
    !Number.isSafeInteger(limits.maxFragmentChars) ||
    limits.maxFragmentChars <= 0
  ) {
    throw new RangeError("context fragment size must be a positive integer");
  }
}

export function buildContextFragments(args: {
  documents: readonly ExtractedSourceDocument[];
  scope: "company" | "job";
  limits: ContextLimits;
}): { fragments: ContextFragment[]; stats: ContextStats } {
  assertLimits(args.limits);
  const fragments: ContextFragment[] = [];

  args.documents.forEach((document, documentIndex) => {
    document.fragments
      .filter((fragment) => fragment.scope === args.scope)
      .forEach((fragment, fragmentIndex) => {
        pieces(fragment.text, args.limits.maxFragmentChars).forEach(
          (text, pieceIndex) => {
            const locator = `${fragment.locator}:fragment-${fragmentIndex + 1}:part-${pieceIndex + 1}`;
            const id = createHash("sha256")
              .update(
                JSON.stringify([
                  document.contentHash,
                  documentIndex,
                  args.scope,
                  locator,
                  text,
                ]),
              )
              .digest("hex");
            fragments.push({
              id,
              scope: args.scope,
              documentIndex,
              text,
              locator,
            });
          },
        );
      });
  });

  const sentChars = fragments.reduce(
    (total, fragment) => total + fragment.text.length,
    0,
  );
  return {
    fragments,
    stats: {
      available: fragments.length,
      sent: fragments.length,
      sentChars,
    },
  };
}
