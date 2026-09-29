import { expect, test } from "vitest";
import { formatDateTime } from "../src/lib/format-date";

test("formats timestamps in Japan time", () => {
  expect(formatDateTime("2026-09-20T15:30:00Z")).toBe("2026年9月21日 00:30");
  expect(formatDateTime("2026-09-20T10:02:03+09:00")).toBe(
    "2026年9月20日 10:02",
  );
});

test("unreadable timestamps are shown as unknown", () => {
  expect(formatDateTime("not-a-date")).toBe("日時不明");
});
