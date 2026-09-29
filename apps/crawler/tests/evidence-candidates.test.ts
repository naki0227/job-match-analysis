import { describe, expect, it } from "vitest";
import { selectEvidenceCandidates } from "../src/evidence-candidates.js";
import { extractSourceDocument } from "../src/source-extractor.js";

const rubrics = [
  {
    axisKey: "work_location",
    anchors: { 0: "出社", 50: "併用", 100: "フルリモート" },
  },
  {
    axisKey: "schedule_flexibility",
    anchors: { 0: "固定", 50: "一部", 100: "フレックス" },
  },
];

function document(html: string) {
  return extractSourceDocument(
    html,
    "https://jobs.example/1",
    new Date("2026-09-29T00:00:00Z"),
  );
}

describe("evidence candidate selection", () => {
  it("selects exact job sentences with stable IDs and source locators", () => {
    const source = document(`<main data-job>
      <p>週2日は在宅勤務できます。勤務場所の詳細は面談でお伝えします。</p>
      <p>コアタイムなしのフレックス勤務です。</p>
      <aside data-company><p>会社全体の制度は別途定めます。</p></aside>
    </main>`);
    const args = {
      documents: [source],
      scope: "job" as const,
      rubrics,
      maxCandidates: 2,
      maxExcerptChars: 120,
    };
    const first = selectEvidenceCandidates(args);
    const second = selectEvidenceCandidates(args);
    expect(first).toEqual(second);
    expect(first.map((item) => item.axisKey)).toEqual([
      "work_location",
      "schedule_flexibility",
    ]);
    expect(first[0]?.excerpt).toBe("週2日は在宅勤務できます。");
    expect(first[0]?.locator).toContain("p:line-");
    expect(
      first.every((item) => item.documentIndex === 0 && item.scope === "job"),
    ).toBe(true);
    expect(
      first.every((item) => source.extractedText.includes(item.excerpt)),
    ).toBe(true);
  });

  it("never borrows a company statement as job evidence", () => {
    const source = document(
      `<main data-job><p>求人本文です。</p><aside data-company><p>会社にはフルリモート制度があります。</p></aside></main>`,
    );
    expect(
      selectEvidenceCandidates({
        documents: [source],
        scope: "job",
        rubrics,
        maxCandidates: 4,
        maxExcerptChars: 120,
      }),
    ).toEqual([]);
    expect(
      selectEvidenceCandidates({
        documents: [source],
        scope: "company",
        rubrics,
        maxCandidates: 4,
        maxExcerptChars: 120,
      })[0]?.excerpt,
    ).toBe("会社にはフルリモート制度があります。");
  });

  it("skips contact or secret bearing sentences before Jev", () => {
    const source = document(`<main data-job>
      <p>在宅勤務の相談は hiring@example.com まで。</p>
      <p>フレックス勤務の鍵 sk-abcdefghijklmnopqr は使わないでください。</p>
      <p>週3日の在宅勤務が明示されています。</p>
    </main>`);
    const candidates = selectEvidenceCandidates({
      documents: [source],
      scope: "job",
      rubrics,
      maxCandidates: 4,
      maxExcerptChars: 120,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.excerpt).toBe("週3日の在宅勤務が明示されています。");
  });

  it("requires explicit bounds and skips oversized sentences without truncating quotes", () => {
    const source = document(
      `<main><p>${"在宅勤務は可能です。".repeat(30)}</p></main>`,
    );
    expect(
      selectEvidenceCandidates({
        documents: [source],
        scope: "job",
        rubrics,
        maxCandidates: 1,
        maxExcerptChars: 3,
      }),
    ).toEqual([]);
    expect(() =>
      selectEvidenceCandidates({
        documents: [source],
        scope: "job",
        rubrics,
        maxCandidates: 0,
        maxExcerptChars: 100,
      }),
    ).toThrow(RangeError);
  });

  it("uses different IDs for duplicate paragraphs on one HTML line", () => {
    const source = document(
      "<main><p>在宅勤務できます。</p><p>在宅勤務できます。</p></main>",
    );
    const candidates = selectEvidenceCandidates({
      documents: [source],
      scope: "job",
      rubrics,
      maxCandidates: 2,
      maxExcerptChars: 120,
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.id).not.toBe(candidates[1]?.id);
  });
});
