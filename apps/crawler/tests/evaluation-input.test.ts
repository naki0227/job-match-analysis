import { describe, expect, it } from "vitest";
import { buildContextFragments } from "../src/context-fragments.js";
import { sourceSetHash } from "../src/evaluation-input.js";
import { extractSourceDocument } from "../src/source-extractor.js";

const limits = {
  maxFragments: 40,
  maxContextChars: 8_000,
  maxFragmentChars: 200,
};

function input(fetchedAt = "2026-09-29T00:00:00Z") {
  const document = extractSourceDocument(
    "<main data-job><p>週2日は在宅勤務できます。</p><p>コアタイムなしのフレックス勤務です。</p></main>",
    "https://jobs.example/1",
    new Date(fetchedAt),
  );
  return {
    documents: [document],
    fragments: buildContextFragments({
      documents: [document],
      scope: "job",
      limits,
    }).fragments,
    scope: "job" as const,
  };
}

describe("evaluation source set hash", () => {
  it("is stable for the same context regardless of fragment order", () => {
    const args = input();
    expect(args.fragments).toHaveLength(2);
    expect(sourceSetHash(args)).toBe(
      sourceSetHash({ ...args, fragments: [...args.fragments].reverse() }),
    );
  });

  it("changes for a fresh fetch or a different context", () => {
    const args = input();
    expect(sourceSetHash(args)).not.toBe(
      sourceSetHash(input("2026-09-30T00:00:00Z")),
    );
    expect(sourceSetHash(args)).not.toBe(
      sourceSetHash({ ...args, fragments: args.fragments.slice(0, 1) }),
    );
  });

  it("rejects empty documents and fragments not in the selected source scope", () => {
    const args = input();
    expect(() => sourceSetHash({ ...args, documents: [] })).toThrow(RangeError);
    expect(() =>
      sourceSetHash({
        ...args,
        fragments: [{ ...args.fragments[0]!, text: "出典には存在しない記述" }],
      }),
    ).toThrow(RangeError);
    expect(() => sourceSetHash({ ...args, scope: "company" })).toThrow(
      RangeError,
    );
  });
});
