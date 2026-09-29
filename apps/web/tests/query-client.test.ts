import { expect, test } from "vitest";
import { createQueryClient } from "../src/lib/query-client";

test("queries and mutations do not retry or refetch implicitly", () => {
  const defaults = createQueryClient().getDefaultOptions();
  expect(defaults.queries).toMatchObject({
    retry: false,
    refetchOnWindowFocus: false,
  });
  expect(defaults.mutations).toMatchObject({ retry: false });
});
