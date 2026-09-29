import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { UiPreview } from "../src/dev/UiPreview";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("every preview screen renders from samples without calling the API", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<UiPreview />);
  const select = screen.getByRole("combobox", { name: "画面" });
  const options = Array.from(select.querySelectorAll("option")).map(
    (option) => option.value,
  );
  expect(options.length).toBeGreaterThanOrEqual(15);
  for (const option of options) {
    fireEvent.change(select, { target: { value: option } });
    expect(screen.getByRole("main")).not.toBeEmptyDOMElement();
  }
  expect(fetcher).not.toHaveBeenCalled();
});
