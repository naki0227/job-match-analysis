import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  careerAxisKeys,
  type CareerProfileResponse,
} from "@job-match/contracts";
import { afterEach, expect, test, vi } from "vitest";
import { SettingsScreen } from "../src/features/settings/SettingsScreen";
import { createQueryWrapper } from "./render-with-query";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const profile: CareerProfileResponse = {
  profileVersionId: "992e2552-0752-4d63-98d9-4d94f1bc2e18",
  profileVersion: 2,
  profile: {
    axisCatalogVersion: 1,
    targetRoles: ["Backend Engineer", "Designer"],
    axisValues: careerAxisKeys.map((axisKey) => ({
      axisKey,
      axisVersion: 1,
      preference: 50,
      importance: 50,
    })),
    constraints: {
      minSalary: { amount: 5_000_000, currency: "JPY", period: "year" },
      allowedPrefectureCodes: ["13", "27"],
      fullRemoteRequired: true,
    },
  },
};

function renderSettings(onSignOut = vi.fn(async () => {})) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(profile), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
  const onEditProfile = vi.fn();
  render(
    <SettingsScreen
      email="sample@example.com"
      onEditProfile={onEditProfile}
      onSignOut={onSignOut}
    />,
    { wrapper: createQueryWrapper() },
  );
  return { onEditProfile, onSignOut };
}

test("preferences summarize the saved profile", async () => {
  const { onEditProfile } = renderSettings();
  expect(await screen.findByText("Backend Engineer、Designer")).toBeVisible();
  expect(screen.getByText("5,000,000円／年")).toBeVisible();
  expect(screen.getByText("東京都・大阪府")).toBeVisible();
  expect(screen.getByText("必須")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "希望条件と8軸を見直す" }),
  );
  expect(onEditProfile).toHaveBeenCalled();
});

test("tabs follow the ARIA keyboard pattern", () => {
  renderSettings();
  const preferences = screen.getByRole("tab", { name: "希望条件" });
  expect(preferences).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveAttribute(
    "aria-labelledby",
    preferences.id,
  );
  fireEvent.keyDown(preferences, { key: "ArrowRight" });
  const privacy = screen.getByRole("tab", { name: "プライバシー" });
  expect(privacy).toHaveAttribute("aria-selected", "true");
  expect(privacy).toHaveFocus();
  expect(screen.getAllByRole("note")[0]).toHaveTextContent("Issue #40");
  fireEvent.keyDown(privacy, { key: "Home" });
  expect(screen.getByRole("tab", { name: "プロフィール" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.keyDown(privacy, { key: "End" });
  expect(screen.getByRole("tab", { name: "アカウント" })).toHaveFocus();
});

test("a failed logout is reported and can be retried", async () => {
  const onSignOut = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce();
  renderSettings(onSignOut);
  fireEvent.click(screen.getByRole("tab", { name: "アカウント" }));
  fireEvent.click(screen.getByRole("button", { name: "ログアウト" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "ログアウトできませんでした",
  );
  fireEvent.click(screen.getByRole("button", { name: "ログアウト" }));
  expect(onSignOut).toHaveBeenCalledTimes(2);
});
