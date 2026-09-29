import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Dialog } from "../src/components/Dialog";
import { PendingFeature } from "../src/components/PendingFeature";
import { useToast } from "../src/components/useToast";
import { AccessTokenProvider } from "../src/features/auth/access-token";
import { useAccessToken } from "../src/features/auth/access-token-context";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("dialog is labelled, focused and closes on Escape or backdrop", () => {
  const onClose = vi.fn();
  const { container } = render(
    <Dialog title="共有カード" onClose={onClose}>
      <p>本文</p>
    </Dialog>,
  );
  const dialog = screen.getByRole("dialog", { name: "共有カード" });
  expect(dialog).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(dialog);
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.click(container.querySelector(".modal-backdrop")!);
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("toast messages disappear after a short time", () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useToast(1_000));
  act(() => result.current.notify("保存しました"));
  expect(result.current.message).toBe("保存しました");
  act(() => vi.advanceTimersByTime(1_000));
  expect(result.current.message).toBe("");
});

test("pending features explain what is missing", () => {
  render(
    <PendingFeature title="分析済み企業" reason="一覧APIの接続待ちです。" />,
  );
  expect(screen.getByRole("note")).toHaveTextContent("一覧APIの接続待ちです。");
});

test("access token getter requires its provider", () => {
  const getter = async () => "token";
  const { result } = renderHook(() => useAccessToken(), {
    wrapper: ({ children }) => (
      <AccessTokenProvider getAccessToken={getter}>
        {children}
      </AccessTokenProvider>
    ),
  });
  expect(result.current).toBe(getter);
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => renderHook(() => useAccessToken())).toThrow(
    "AccessTokenProvider is missing",
  );
});
