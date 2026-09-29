import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
} from "../src/history-cursor.js";

const filters = {
  role: "Backend Engineer",
  judgement: "has_unknown" as const,
  sort: "fewest_unknown" as const,
};
const cursor = {
  sortCount: -2,
  analyzedAt: "2026-09-29T12:00:00Z",
  matchResultId: "00000000-0000-4000-8000-000000000001",
};

test("cursor round trip preserves the sort tuple and filter binding", () => {
  const encoded = encodeHistoryCursor(cursor, filters);
  assert.deepEqual(decodeHistoryCursor(encoded, filters), cursor);
  assert.equal(
    decodeHistoryCursor(encoded, { ...filters, role: "Designer" }),
    null,
  );
  assert.equal(
    decodeHistoryCursor(encoded, { ...filters, sort: "recent" }),
    null,
  );
});

test("malformed or partial cursors are rejected", () => {
  assert.equal(decodeHistoryCursor("not-base64", filters), null);
  assert.equal(
    decodeHistoryCursor(
      Buffer.from(JSON.stringify({ version: 1 })).toString("base64url"),
      filters,
    ),
    null,
  );
});
