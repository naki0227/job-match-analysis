import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LegalConsent } from "../src/features/onboarding/LegalConsent";

afterEach(cleanup);

test("both documents must be acknowledged before continuing", () => {
  const onAccept = vi.fn();
  render(<LegalConsent onAccept={onAccept} />);
  const next = screen.getByRole("button", { name: "次へ" });
  expect(next).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /利用規約/ }));
  expect(next).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /プライバシーポリシー/ }),
  );
  fireEvent.click(next);
  expect(onAccept).toHaveBeenCalled();
});
