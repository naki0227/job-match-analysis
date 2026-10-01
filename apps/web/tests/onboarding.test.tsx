import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { sampleLegalDocuments } from "../src/dev/fixtures";
import { LegalConsent } from "../src/features/onboarding/LegalConsent";

afterEach(cleanup);

function renderConsent() {
  const onAccept = vi.fn();
  render(<LegalConsent documents={sampleLegalDocuments} onAccept={onAccept} />);
  return {
    onAccept,
    next: screen.getByRole("button", { name: "次へ" }),
    terms: screen.getByRole("checkbox", { name: /利用規約.*同意する/ }),
    privacy: screen.getByRole("checkbox", {
      name: /プライバシーポリシー.*確認した/,
    }),
  };
}

test("terms alone or the privacy policy alone is not enough", () => {
  const { next, terms, privacy, onAccept } = renderConsent();
  expect(next).toBeDisabled();
  fireEvent.click(terms);
  expect(next).toBeDisabled();
  fireEvent.click(terms);
  fireEvent.click(privacy);
  expect(next).toBeDisabled();
  expect(onAccept).not.toHaveBeenCalled();
});

test("both confirmations send exactly the shown versions", () => {
  const { next, terms, privacy, onAccept } = renderConsent();
  expect(screen.getAllByText(/第1.0版/, { selector: "span" })).toHaveLength(2);
  fireEvent.click(terms);
  fireEvent.click(privacy);
  fireEvent.click(next);
  expect(onAccept).toHaveBeenCalledWith({
    termsDocumentId: sampleLegalDocuments.terms.id,
    privacyPolicyDocumentId: sampleLegalDocuments.privacyPolicy.id,
  });
});

test("each document's full text can be read before confirming", () => {
  renderConsent();
  fireEvent.click(screen.getByRole("button", { name: "利用規約を読む" }));
  const dialog = screen.getByRole("dialog", { name: "利用規約" });
  expect(dialog).toHaveTextContent("利用規約（プレビュー用サンプル）");
  fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
  fireEvent.click(
    screen.getByRole("button", { name: "プライバシーポリシーを読む" }),
  );
  expect(
    screen.getByRole("dialog", { name: "プライバシーポリシー" }),
  ).toHaveTextContent("プライバシーポリシー（プレビュー用サンプル）");
});

test("document text is shown as text, never as HTML", () => {
  render(
    <LegalConsent
      documents={{
        ...sampleLegalDocuments,
        terms: {
          ...sampleLegalDocuments.terms,
          bodyMarkdown: "<img src=x onerror=alert(1)>本文",
        },
      }}
      onAccept={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "利用規約を読む" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "<img src=x onerror=alert(1)>本文",
  );
  expect(document.querySelector("img[src=x]")).toBeNull();
});
