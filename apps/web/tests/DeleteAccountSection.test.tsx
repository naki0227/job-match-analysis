import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { deleteAccount } from "../src/features/settings/account-api";
import { DeleteAccountSection } from "../src/features/settings/DeleteAccountSection";
import { createQueryWrapper } from "./render-with-query";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openDialog(onDeleted = vi.fn()) {
  render(<DeleteAccountSection onDeleted={onDeleted} />, {
    wrapper: createQueryWrapper(),
  });
  fireEvent.click(screen.getByRole("button", { name: "退会の手続きへ" }));
  return {
    dialog: screen.getByRole("dialog", { name: "本当に退会しますか？" }),
    onDeleted,
  };
}

test("deletion needs the typed phrase and sends the explicit confirmation", async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const { dialog, onDeleted } = openDialog();
  expect(dialog).toHaveTextContent("取り消せません");
  const confirm = within(dialog).getByRole("button", {
    name: "完全に削除する",
  });
  expect(confirm).toBeDisabled();
  const input = within(dialog).getByLabelText(/「退会する」と入力/);
  fireEvent.change(input, { target: { value: "退会" } });
  expect(confirm).toBeDisabled();
  fireEvent.change(input, { target: { value: "退会する" } });
  fireEvent.click(confirm);
  await vi.waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(fetcher).toHaveBeenCalledWith(
    "/api/v1/me",
    expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ confirmation: "delete-my-account" }),
    }),
  );
});

test("a failed deletion keeps the account and says so", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ code: "x" }, { status: 503 })),
  );
  const { dialog, onDeleted } = openDialog();
  fireEvent.change(within(dialog).getByLabelText(/「退会する」と入力/), {
    target: { value: "退会する" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "完全に削除する" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "データは削除されていません",
  );
  expect(onDeleted).not.toHaveBeenCalled();
});

test("closing the dialog does not delete anything", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  openDialog();
  fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});

test("the API client treats anything but 204 as failure", async () => {
  await expect(
    deleteAccount("t", async () => new Response(null, { status: 200 })),
  ).rejects.toThrow("Account deletion failed");
  await expect(
    deleteAccount("t", async () => {
      throw new TypeError("offline");
    }),
  ).rejects.toThrow("Account deletion failed");
});
