import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  careerAxisKeys,
  type CareerProfileResponse,
} from "@job-match/contracts";
import { afterEach, expect, test, vi } from "vitest";
import { CareerProfileForm } from "../src/features/career-profile/CareerProfileForm";

const firstVersionId = "992e2552-0752-4d63-98d9-4d94f1bc2e18";
const secondVersionId = "916098d3-3873-4323-b0de-b20bef5dcedb";
const key = "ac96a563-06f6-435c-bebd-960920f6372c";
const initial: CareerProfileResponse = {
  profileVersionId: firstVersionId,
  profileVersion: 1,
  profile: {
    axisCatalogVersion: 1,
    targetRoles: ["エンジニア"],
    axisValues: careerAxisKeys.map((axisKey) => ({
      axisKey,
      axisVersion: 1,
      preference: 50,
      importance: 50,
    })),
    constraints: { allowedPrefectureCodes: ["13"], fullRemoteRequired: false },
  },
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("saved version reloads and an edit creates a new version", async () => {
  let current = initial;
  const writes: unknown[] = [];
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const request = JSON.parse(String(init.body));
        writes.push(request);
        current = {
          profileVersionId: secondVersionId,
          profileVersion: 2,
          profile: request.profile,
        };
        return jsonResponse(current);
      }
      return jsonResponse(current);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("crypto", { randomUUID: () => key });

  const view = render(
    <CareerProfileForm getAccessToken={async () => "token"} />,
  );
  const role = await screen.findByRole("textbox", { name: "希望職種" });
  expect(role).toHaveValue("エンジニア");
  expect(screen.getByText("現在の確定版: 第1版")).toBeInTheDocument();
  fireEvent.change(role, { target: { value: "デザイナー" } });
  fireEvent.click(screen.getByRole("button", { name: "診断を保存" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "第2版を保存しました。",
  );
  expect(writes).toMatchObject([
    {
      expectedVersion: 1,
      idempotencyKey: key,
      profile: { targetRoles: ["デザイナー"] },
    },
  ]);

  view.unmount();
  render(<CareerProfileForm getAccessToken={async () => "token"} />);
  expect(await screen.findByRole("textbox", { name: "希望職種" })).toHaveValue(
    "デザイナー",
  );
  expect(screen.getByText("現在の確定版: 第2版")).toBeInTheDocument();
});

test("unanswered axes cannot be saved", async () => {
  const fetcher = vi.fn(async () => jsonResponse({ code: "not_found" }, 404));
  vi.stubGlobal("fetch", fetcher);
  render(<CareerProfileForm getAccessToken={async () => "token"} />);
  fireEvent.change(await screen.findByRole("textbox", { name: "希望職種" }), {
    target: { value: "エンジニア" },
  });
  fireEvent.click(screen.getByRole("button", { name: "診断を保存" }));
  expect(await screen.findByRole("status")).toHaveTextContent("8軸すべて");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("keyboard-accessible sliders preserve 0 and 100 in separate fields", async () => {
  const writes: unknown[] = [];
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "PUT") return jsonResponse({}, 404);
      const request = JSON.parse(String(init.body));
      writes.push(request);
      return jsonResponse(
        {
          profileVersionId: firstVersionId,
          profileVersion: 1,
          profile: request.profile,
        },
        201,
      );
    },
  );
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("crypto", { randomUUID: () => key });

  render(<CareerProfileForm getAccessToken={async () => "token"} />);
  fireEvent.change(await screen.findByRole("textbox", { name: "希望職種" }), {
    target: { value: "エンジニア" },
  });
  for (const button of screen.getAllByRole("button", { name: "回答する" })) {
    fireEvent.click(button);
  }
  const sliders = screen.getAllByRole("slider");
  expect(sliders).toHaveLength(16);
  fireEvent.change(sliders[0]!, { target: { value: "0" } });
  fireEvent.change(sliders[1]!, { target: { value: "100" } });
  fireEvent.click(screen.getByRole("button", { name: "診断を保存" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  const request = writes[0] as {
    profile: {
      axisValues: Array<{
        axisKey: string;
        preference: number;
        importance: number;
      }>;
    };
  };
  expect(request.profile.axisValues[0]).toMatchObject({
    axisKey: "work_location",
    preference: 0,
    importance: 100,
  });
});
