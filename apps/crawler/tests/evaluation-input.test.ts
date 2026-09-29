import { describe, expect, it } from "vitest";
import { sourceSetHash } from "../src/evaluation-input.js";
import { selectEvidenceCandidates } from "../src/evidence-candidates.js";
import { extractSourceDocument } from "../src/source-extractor.js";

const rubrics = [
  { axisKey: "work_location", anchors: { 0: "出社", 50: "併用", 100: "在宅" } },
  {
    axisKey: "schedule_flexibility",
    anchors: { 0: "固定", 50: "一部", 100: "自由" },
  },
];

function input(fetchedAt = "2026-09-29T00:00:00Z") {
  const document = extractSourceDocument(
    "<main data-job><p>週2日は在宅勤務できます。</p><p>コアタイムなしのフレックス勤務です。</p></main>",
    "https://jobs.example/1",
    new Date(fetchedAt),
  );
  return {
    documents: [document],
    candidates: selectEvidenceCandidates({
      documents: [document],
      scope: "job" as const,
      rubrics,
      maxCandidates: 4,
      maxExcerptChars: 120,
    }),
    scope: "job" as const,
  };
}

describe("evaluation source set hash", () => {
  it("is stable for the same source and candidate set regardless of candidate order", () => {
    const args = input();
    expect(args.candidates).toHaveLength(2);
    expect(sourceSetHash(args)).toBe(
      sourceSetHash({ ...args, candidates: [...args.candidates].reverse() }),
    );
  });

  it("changes for a fresh fetch or a different candidate set", () => {
    const args = input();
    expect(sourceSetHash(args)).not.toBe(
      sourceSetHash(input("2026-09-30T00:00:00Z")),
    );
    expect(sourceSetHash(args)).not.toBe(
      sourceSetHash({ ...args, candidates: args.candidates.slice(0, 1) }),
    );
  });

  it("rejects empty documents and candidates outside the selected source scope", () => {
    const args = input();
    expect(() => sourceSetHash({ ...args, documents: [] })).toThrow(RangeError);
    expect(() =>
      sourceSetHash({
        ...args,
        candidates: [
          { ...args.candidates[0]!, excerpt: "出典には存在しない記述" },
        ],
      }),
    ).toThrow(RangeError);
    expect(() => sourceSetHash({ ...args, scope: "company" })).toThrow(
      RangeError,
    );
  });
});
