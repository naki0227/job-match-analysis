import { createHash } from "node:crypto";
import type { ContextFragment } from "./decision-engine.js";
import type { ExtractedSourceDocument } from "./source-extractor.js";

/**
 * Part of every evaluator version and source set hash: changing how the
 * context is built must never reuse evaluations made from another context.
 */
export const CONTEXT_SELECTOR_VERSION = "context-fragments-v5";

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

/** Sentence ends and list markers: where a reader would break the text. */
const NATURAL_BREAK =
  /(?<=[。！？!?])|(?<=[.;；])(?=\s)|\s(?=[■●◆▼・※↓【]|-\S)/gu;

function lastBreakIn(
  breaks: readonly number[],
  start: number,
  limit: number,
): number | undefined {
  let found: number | undefined;
  for (const index of breaks) {
    if (index <= start) continue;
    if (index > limit) break;
    found = index;
  }
  return found;
}

/**
 * Split only so evidence can point to a bounded exact substring. Pieces
 * end at a sentence end or list marker when one fits, else at a space, and
 * only a single unbroken run longer than the limit is cut mid-word. Every
 * non-whitespace character is kept, in order.
 */
function pieces(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return text.trim() ? [text.trim()] : [];
  const natural = [...text.matchAll(NATURAL_BREAK)].map((match) => match.index);
  const spaces = [...text.matchAll(/\s/gu)].map((match) => match.index);
  const result: string[] = [];
  let start = 0;
  while (text.length - start > maxChars) {
    const limit = start + maxChars;
    const cut =
      lastBreakIn(natural, start, limit) ??
      lastBreakIn(spaces, start, limit) ??
      limit;
    const piece = text.slice(start, cut).trim();
    if (piece) result.push(piece);
    start = cut;
  }
  const tail = text.slice(start).trim();
  if (tail) result.push(tail);
  return result;
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
              ...(fragment.section ? { section: fragment.section } : {}),
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
