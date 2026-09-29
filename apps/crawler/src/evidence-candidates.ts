import { createHash } from "node:crypto";
import type { AxisRubric, EvidenceCandidate } from "./decision-engine.js";
import type { ExtractedSourceDocument } from "./source-extractor.js";

export const CANDIDATE_SELECTOR_VERSION = "axis-keywords-v1";

const axisTerms: Readonly<Record<string, RegExp>> = {
  work_location: /リモート|在宅|出社|出勤|勤務地|remote|on.?site|hybrid/i,
  autonomy: /裁量|自律|決定権|承認|手順|方針|autonom|ownership|decision/i,
  collaboration: /チーム|協働|共同|一人|個人|team|collaborat|individual/i,
  growth_direction:
    /専門性|専門分野|新しい領域|未経験|成長|specializ|new domain|learn/i,
  work_change: /変化|優先順位|定型|頻繁|予測可能|dynamic|priority|routine/i,
  schedule_flexibility:
    /勤務時間|始業|終業|フレックス|コアタイム|時差|schedule|flexible hours/i,
  role_breadth:
    /幅広|兼務|横断|担当領域|専門領域|複数領域|cross.functional|generalist/i,
  customer_contact:
    /顧客|利用者|ユーザー|接客|対話|customer|client|user contact/i,
};

function sentences(text: string): string[] {
  return (
    text
      .match(/[^。！？\n]+[。！？]?/gu)
      ?.map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function hasContactOrSecret(text: string): boolean {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\bsk-[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~-]{16,}\b|(?:\+?\d[\d ()-]{8,}\d)/i.test(
    text,
  );
}

export function selectEvidenceCandidates(args: {
  documents: readonly ExtractedSourceDocument[];
  scope: "company" | "job";
  rubrics: readonly AxisRubric[];
  maxCandidates: number;
  maxExcerptChars: number;
}): EvidenceCandidate[] {
  if (
    !Number.isSafeInteger(args.maxCandidates) ||
    args.maxCandidates <= 0 ||
    !Number.isSafeInteger(args.maxExcerptChars) ||
    args.maxExcerptChars <= 0
  )
    throw new RangeError("candidate limits must be positive integers");
  const perAxis = new Map<string, EvidenceCandidate[]>();
  for (const rubric of args.rubrics) {
    const term = axisTerms[rubric.axisKey];
    const matches: EvidenceCandidate[] = [];
    if (term) {
      args.documents.forEach((document, documentIndex) => {
        document.fragments
          .filter((fragment) => fragment.scope === args.scope)
          .forEach((fragment, fragmentIndex) => {
            sentences(fragment.text).forEach((excerpt, sentenceIndex) => {
              if (
                excerpt.length > args.maxExcerptChars ||
                excerpt.replace(/\s/g, "").length < 6 ||
                hasContactOrSecret(excerpt) ||
                !term.test(excerpt)
              )
                return;
              const locator = `${fragment.locator}:fragment-${fragmentIndex + 1}:sentence-${sentenceIndex + 1}`;
              const id = createHash("sha256")
                .update(
                  JSON.stringify([
                    document.contentHash,
                    documentIndex,
                    args.scope,
                    rubric.axisKey,
                    locator,
                    excerpt,
                  ]),
                )
                .digest("hex");
              matches.push({
                id,
                axisKey: rubric.axisKey,
                scope: args.scope,
                documentIndex,
                excerpt,
                locator,
              });
            });
          });
      });
    }
    perAxis.set(rubric.axisKey, matches);
  }
  const selected: EvidenceCandidate[] = [];
  for (let offset = 0; selected.length < args.maxCandidates; offset += 1) {
    let added = false;
    for (const rubric of args.rubrics) {
      const candidate = perAxis.get(rubric.axisKey)?.[offset];
      if (!candidate) continue;
      selected.push(candidate);
      added = true;
      if (selected.length === args.maxCandidates) break;
    }
    if (!added) break;
  }
  return selected;
}
