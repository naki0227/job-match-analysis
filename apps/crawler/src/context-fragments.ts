import { createHash } from "node:crypto";
import type { ContextFragment } from "./decision-engine.js";
import type { ExtractedSourceDocument } from "./source-extractor.js";

/**
 * Part of every evaluator version and source set hash: changing how the
 * context is built must never reuse evaluations made from another context.
 */
export const CONTEXT_SELECTOR_VERSION = "context-fragments-v2";

export type ContextLimits = {
  /** Most fragments sent to the evaluator for one document. */
  maxFragments: number;
  /** Most characters of fragment text sent to the evaluator in total. */
  maxContextChars: number;
  /** Longest fragment, and so the longest quote stored as evidence. */
  maxFragmentChars: number;
};

export type ContextStats = {
  /** Usable fragments before the limits were applied. */
  available: number;
  sent: number;
  sentChars: number;
};

/**
 * Only used to decide what to keep when a page exceeds the limits. Unlike
 * the old keyword selector, a fragment without any of these words is still
 * sent whenever it fits, so wording never makes an axis unknowable.
 */
const AXIS_HINTS = new RegExp(
  [
    // where and when
    "リモート|在宅|自宅|出社|出勤|オフィス|拠点|勤務|働き方|働く|時間帯|フレックス|コアタイム|時差|休日|スケジュール",
    // how decisions are made
    "裁量|自律|任せ|任され|決め|決定|承認|手順|方針|ルール|マニュアル",
    // with whom
    "チーム|協働|共同|連携|一人|個人|メンバー|顧客|お客様|利用者|ユーザー|接客|対面|訪問|商談|伴走|問い合わせ",
    // what changes and how broad
    "専門|新た|新しい|挑戦|未経験|成長|キャリア|変化|優先|順序|入れ替|定型|ルーティン|幅広|兼務|横断|担当|関わ|受け持",
    "remote|office|home|anywhere|on.?site|hybrid|hours|flexib|schedule",
    "autonom|ownership|own|decide|decision|drive|process|approval",
    "team|squad|collaborat|individual|alone|customer|client|user|visit",
    "special|explore|new|learn|grow|priorit|shift|routine|cross|end to end",
  ].join("|"),
  "iu",
);

function hasContactOrSecret(text: string): boolean {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\bsk-[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~-]{16,}\b|(?:\+?\d[\d ()-]{8,}\d)/i.test(
    text,
  );
}

function sentences(text: string): string[] {
  return (
    text
      .match(/[^。！？\n]+[。！？]?/gu)
      ?.map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

/** Whole fragments when short; otherwise split every sentence without dropping its tail. */
function pieces(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
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
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError("context limits must be positive integers");
  }
}

export function buildContextFragments(args: {
  documents: readonly ExtractedSourceDocument[];
  scope: "company" | "job";
  limits: ContextLimits;
}): { fragments: ContextFragment[]; stats: ContextStats } {
  assertLimits(args.limits);
  const seen = new Set<string>();
  const all: ContextFragment[] = [];
  args.documents.forEach((document, documentIndex) => {
    document.fragments
      .filter((fragment) => fragment.scope === args.scope)
      .forEach((fragment, fragmentIndex) => {
        pieces(fragment.text, args.limits.maxFragmentChars).forEach(
          (text, pieceIndex) => {
            const normalized = text.replace(/\s+/g, "").toLowerCase();
            if (
              normalized.length < 4 ||
              seen.has(normalized) ||
              hasContactOrSecret(text)
            )
              return;
            seen.add(normalized);
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
            all.push({
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

  // Within the limits, hinted fragments go first; the result keeps page order.
  const ranked = all
    .map((fragment, order) => ({ fragment, order }))
    .sort(
      (a, b) =>
        Number(AXIS_HINTS.test(b.fragment.text)) -
          Number(AXIS_HINTS.test(a.fragment.text)) || a.order - b.order,
    );
  const kept: { fragment: ContextFragment; order: number }[] = [];
  let chars = 0;
  for (const item of ranked) {
    if (kept.length === args.limits.maxFragments) break;
    if (chars + item.fragment.text.length > args.limits.maxContextChars)
      continue;
    kept.push(item);
    chars += item.fragment.text.length;
  }
  const fragments = kept
    .sort((a, b) => a.order - b.order)
    .map(({ fragment }) => fragment);
  return {
    fragments,
    stats: { available: all.length, sent: fragments.length, sentChars: chars },
  };
}
