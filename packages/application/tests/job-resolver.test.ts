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

describe("web discovery", () => {
  const web = (title: string, n: number): JobCandidate => ({
    ...posting(title, `https://careers.sample.example/jobs/${n}`),
    source: "official",
  });

  it("does not search the web when known postings answer the role", async () => {
    const discovery = vi.fn();
    const result = await resolveJob(query, {
      sources: [
        source("known", [posting("法人営業", "https://ats.example/1")]),
      ],
      discovery,
      maxCandidates: 20,
    });
    expect(result.status).toBe("resolved");
    expect(discovery).not.toHaveBeenCalled();
  });

  it("starts a discovery when known postings miss, and reports it as searching", async () => {
    const result = await resolveJob(query, {
      sources: [source("known", [])],
      discovery: async () => ({ status: "pending", discoveryId: "d1" }),
      maxCandidates: 20,
    });
    expect(result).toEqual({
      status: "searching",
      discoveryId: "d1",
      failedSources: [],
      selectorUsed: false,
    });
  });

  it("uses finished discovery results like known ones", async () => {
    const result = await resolveJob(query, {
      sources: [source("known", [])],
      discovery: async () => ({
        status: "ready",
        cached: true,
        candidates: [web("法人営業", 1), web("採用担当", 2)],
      }),
      maxCandidates: 20,
    });
    expect(result).toMatchObject({
      status: "resolved",
      candidate: { url: "https://careers.sample.example/jobs/1" },
    });
  });

  it("falls back to known postings when discovery is unavailable or throws", async () => {
    for (const discovery of [
      async () => ({
        status: "unavailable" as const,
        reason: "rate_limited" as const,
      }),
      async () => Promise.reject(new Error("provider blocked")),
    ]) {
      const result = await resolveJob(query, {
        sources: [
          source("known", [
            posting("カスタマーサクセス", "https://ats.example/1"),
          ]),
        ],
        discovery,
        maxCandidates: 20,
      });
      expect(result).toMatchObject({
        status: "candidates",
        failedSources: ["discovery"],
      });
    }
  });

  it("lists every found posting for a company-only search and never asks the selector", async () => {
    const selector = vi.fn();
    const result = await resolveJob(
      { company: "サンプル" },
      {
        sources: [
          source("known", [posting("法人営業", "https://ats.example/1")]),
        ],
        discovery: async () => ({
          status: "ready",
          cached: false,
          candidates: [web("Backend Engineer", 1), web("Product Manager", 2)],
        }),
        selector,
        maxCandidates: 20,
        listingLimit: 2,
        knownListingMinimum: 5,
      },
    );
    expect(selector).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "candidates",
      reason: "company_listing",
      hasMore: true,
    });
    if (result.status === "candidates") {
      expect(result.candidates.map((item) => item.source)).toEqual([
        "official",
        "official",
      ]);
    }
  });
});
