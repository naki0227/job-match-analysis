import type { JobCandidate } from "@job-match/domain";
import { describe, expect, it, vi } from "vitest";
import { resolveJob, type CandidateSource } from "../src/job-resolver.js";

const posting = (title: string, url: string): JobCandidate => ({
  companyName: "サンプル株式会社",
  title,
  url,
  source: "known",
  employmentTypes: [],
});

const source = (name: string, found: JobCandidate[]): CandidateSource => ({
  name,
  discover: async () => found,
});

const query = { company: "サンプル", roleQuery: "法人営業" };

describe("resolveJob", () => {
  it("merges sources, keeps going when one fails and skips the selector for a single full match", async () => {
    const selector = vi.fn();
    const onSourceError = vi.fn();
    const result = await resolveJob(query, {
      sources: [
        source("known", [posting("法人営業", "https://ats.example/1")]),
        {
          name: "ats",
          discover: async () => Promise.reject(new Error("down")),
        },
      ],
      selector,
      maxCandidates: 20,
      onSourceError,
    });
    expect(result).toMatchObject({
      status: "resolved",
      reason: "single_full_match",
      failedSources: ["ats"],
      selectorUsed: false,
    });
    expect(selector).not.toHaveBeenCalled();
    expect(onSourceError).toHaveBeenCalledWith("ats");
  });

  it("lets the selector choose only among the filtered, capped candidates", async () => {
    const selector = vi.fn(
      async (_query, candidates: readonly { id: string }[]) => ({
        choice: candidates[1]!.id,
        confidence: 0.92,
        probabilities: { c1: 0.05, c2: 0.9, none: 0.05 },
      }),
    );
    const result = await resolveJob(query, {
      sources: [
        source("known", [
          posting("法人営業（東京）", "https://ats.example/1"),
          posting("法人営業（大阪）", "https://ats.example/2"),
          posting("法人営業（福岡）", "https://ats.example/3"),
        ]),
      ],
      selector,
      maxCandidates: 2,
    });
    expect(selector.mock.calls[0]![1]).toHaveLength(2);
    expect(result).toMatchObject({
      status: "resolved",
      reason: "confident_selection",
      candidate: { url: "https://ats.example/2" },
      selectorUsed: true,
    });
  });

  it("falls back to a user choice when the selector fails, and not_found when nothing matches", async () => {
    const onSelectorError = vi.fn();
    const ambiguous = await resolveJob(query, {
      sources: [
        source("known", [
          posting("法人営業", "https://ats.example/1"),
          posting("法人営業リーダー", "https://ats.example/2"),
        ]),
      ],
      selector: async () => Promise.reject(new Error("timeout")),
      maxCandidates: 20,
      onSelectorError,
    });
    expect(ambiguous).toMatchObject({
      status: "candidates",
      selectorUsed: false,
    });
    expect(onSelectorError).toHaveBeenCalledOnce();
    const none = await resolveJob(
      { company: "別会社", roleQuery: "法人営業" },
      {
        sources: [
          source("known", [posting("法人営業", "https://ats.example/1")]),
        ],
        maxCandidates: 20,
      },
    );
    expect(none).toMatchObject({
      status: "not_found",
      reason: "no_candidates",
    });
  });
});
