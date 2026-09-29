import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  careerAxisKeys,
  type CareerProfileResponse,
} from "@job-match/contracts";
import { afterEach, expect, test, vi } from "vitest";
import { InsightsScreen } from "../src/features/insights/InsightsScreen";
import {
  polygonPoints,
  radarPoint,
} from "../src/features/insights/radar-geometry";
import { createQueryWrapper } from "./render-with-query";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("radar points start at the top and clamp values", () => {
  expect(radarPoint(0, 8, 100)).toEqual({ x: 210, y: 60 });
  expect(radarPoint(2, 8, 100)).toEqual({ x: 360, y: 210 });
  expect(radarPoint(0, 8, 0)).toEqual({ x: 210, y: 210 });
  expect(radarPoint(0, 8, 150)).toEqual(radarPoint(0, 8, 100));
  expect(polygonPoints([0, 0, 0])).toBe("210,210 210,210 210,210");
  expect(() => radarPoint(0, 2, 50)).toThrow(RangeError);
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("without a profile the screen asks for one", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ code: "not_found" }, 404)),
  );
  const onEditProfile = vi.fn();
  render(<InsightsScreen onEditProfile={onEditProfile} />, {
    wrapper: createQueryWrapper(),
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "希望条件を入力する" }),
  );
  expect(onEditProfile).toHaveBeenCalled();
});

test("own axes render as a radar and a table; cohorts are not faked", async () => {
  const profile: CareerProfileResponse = {
    profileVersionId: "992e2552-0752-4d63-98d9-4d94f1bc2e18",
    profileVersion: 3,
    profile: {
      axisCatalogVersion: 1,
      targetRoles: ["Designer"],
      axisValues: careerAxisKeys.map((axisKey, index) => ({
        axisKey,
        axisVersion: 1,
        preference: index * 10,
        importance: index === 1 ? 0 : 50,
      })),
      constraints: { allowedPrefectureCodes: [], fullRemoteRequired: false },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(profile)),
  );
  render(<InsightsScreen onEditProfile={vi.fn()} />, {
    wrapper: createQueryWrapper(),
  });
  expect(
    await screen.findByRole("img", { name: /あなたの希望（第3版）/ }),
  ).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "あなたの希望（第3版）" });
  expect(table).toHaveTextContent("裁量10比較しない");
  fireEvent.click(screen.getByRole("button", { name: "全体" }));
  expect(screen.getByRole("note")).toHaveTextContent("「全体」との比較");
  expect(screen.getByRole("note")).toHaveTextContent("Issue #40");
});
