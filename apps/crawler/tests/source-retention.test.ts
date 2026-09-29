import { describe, expect, it, vi } from "vitest";
import {
  clearExpiredSourceText,
  SourceRetentionError,
  type SourceRetentionStore,
} from "../src/source-retention.js";

const id = "20000000-0000-4000-8000-000000000001";
const now = new Date("2026-10-01T00:00:00Z");

describe("source text retention", () => {
  it("clears only the bounded 30-day batch", async () => {
    const loadExpiredIds = vi.fn(async () => [id]);
    const clearExpiredText = vi.fn(async () => 1);
    expect(
      await clearExpiredSourceText({
        store: { loadExpiredIds, clearExpiredText },
        now,
        batchSize: 100,
      }),
    ).toBe(1);
    expect(loadExpiredIds).toHaveBeenCalledWith(
      "2026-09-01T00:00:00.000Z",
      100,
    );
    expect(clearExpiredText).toHaveBeenCalledWith(
      [id],
      "2026-09-01T00:00:00.000Z",
    );
  });

  it("does not update when no text has expired", async () => {
    const clearExpiredText = vi.fn(async () => 0);
    const store: SourceRetentionStore = {
      loadExpiredIds: async () => [],
      clearExpiredText,
    };
    expect(await clearExpiredSourceText({ store, now, batchSize: 1 })).toBe(0);
    expect(clearExpiredText).not.toHaveBeenCalled();
  });

  it("rejects invalid bounds and malformed storage IDs", async () => {
    const store: SourceRetentionStore = {
      loadExpiredIds: async () => ["invalid"],
      clearExpiredText: async () => 1,
    };
    await expect(
      clearExpiredSourceText({ store, now, batchSize: 100 }),
    ).rejects.toBeInstanceOf(SourceRetentionError);
    await expect(
      clearExpiredSourceText({ store, now, batchSize: 0 }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("rejects impossible update counts", async () => {
    const store: SourceRetentionStore = {
      loadExpiredIds: async () => [id],
      clearExpiredText: async () => 2,
    };
    await expect(
      clearExpiredSourceText({ store, now, batchSize: 1 }),
    ).rejects.toBeInstanceOf(SourceRetentionError);
  });
});
