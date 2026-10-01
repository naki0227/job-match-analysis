import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  careerAxisKeys,
  type CareerProfileResponse,
} from "@job-match/contracts";
import { afterEach, expect, test, vi } from "vitest";
import { CareerProfileWizard } from "../src/features/career-profile/CareerProfileWizard";
import { createQueryWrapper } from "./render-with-query";

const key = "ac96a563-06f6-435c-bebd-960920f6372c";
const saved: CareerProfileResponse = {
  profileVersionId: "992e2552-0752-4d63-98d9-4d94f1bc2e18",
  profileVersion: 1,
  profile: {
    axisCatalogVersion: 1,
    targetRoles: ["エンジニア"],
    axisValues: careerAxisKeys.map((axisKey) => ({
      axisKey,
      axisVersion: 1,
      preference: 50,
      importance: axisKey === "autonomy" ? 60 : 50,
    })),
    constraints: { allowedPrefectureCodes: ["13"], fullRemoteRequired: false },
  },
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function next() {
  fireEvent.click(screen.getByRole("button", { name: "次へ" }));
}

test("a new user answers every step before saving the first version", async () => {
  const writes: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "PUT") return json({ code: "not_found" }, 404);
      const request = JSON.parse(String(init.body));
      writes.push(request);
      return json(
        {
          profileVersionId: saved.profileVersionId,
          profileVersion: 1,
          profile: request.profile,
        },
        201,
      );
    }),
  );
  vi.stubGlobal("crypto", { randomUUID: () => key });
  const onSaved = vi.fn();
  render(<CareerProfileWizard onSaved={onSaved} />, {
    wrapper: createQueryWrapper(),
  });

  expect(await screen.findByText(/現在の確定版: 未保存/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "次へ" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "IT・エンジニア" }));
  fireEvent.click(
    within(
      screen.getByRole("group", { name: "IT・エンジニアの職種の例" }),
    ).getByRole("button", { name: "バックエンドエンジニア" }),
  );
  next();

  for (const [index] of careerAxisKeys.entries()) {
    expect(screen.getByText(`${index + 1} / 8`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "次へ" })).toBeDisabled();
    if (index === 0) {
      fireEvent.change(screen.getByRole("slider", { name: "希望値" }), {
        target: { value: "0" },
      });
      fireEvent.click(screen.getByRole("radio", { name: "とても重視" }));
    } else {
      fireEvent.click(screen.getByRole("radio", { name: "比較しない" }));
    }
    next();
  }

  fireEvent.change(
    screen.getByRole("spinbutton", { name: "最低年収（円、額面）" }),
    {
      target: { value: "5000000" },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "保存する" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
  expect(writes[0]).toMatchObject({
    expectedVersion: 0,
    idempotencyKey: key,
    profile: {
      targetRoles: ["バックエンドエンジニア"],
      constraints: { minSalary: { amount: 5_000_000 } },
    },
  });
  const axes = (writes[0]!.profile as { axisValues: unknown[] }).axisValues;
  expect(axes[0]).toMatchObject({ preference: 0, importance: 100 });
  expect(axes[1]).toMatchObject({ preference: 50, importance: 0 });
});

test("a saved profile loads, keeps non-standard importance and saves a new version", async () => {
  const writes: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "PUT") return json(saved);
      const request = JSON.parse(String(init.body));
      writes.push(request);
      return json({ ...saved, profileVersion: 2, profile: request.profile });
    }),
  );
  vi.stubGlobal("crypto", { randomUUID: () => key });
  const onSaved = vi.fn();
  render(<CareerProfileWizard onSaved={onSaved} />, {
    wrapper: createQueryWrapper(),
  });
  expect(await screen.findByText(/現在の確定版: 第1版/)).toBeInTheDocument();
  expect(
    within(screen.getByRole("group", { name: "選んだ職種" })).getByRole(
      "button",
      { name: "エンジニア" },
    ),
  ).toHaveAttribute("aria-pressed", "true");
  next();
  next();
  expect(screen.getByText(/保存済みの重要度: 60/)).toBeInTheDocument();
  for (let step = 0; step < 7; step += 1) next();
  fireEvent.click(screen.getByRole("button", { name: "保存する" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(2));
  expect(writes[0]).toMatchObject({ expectedVersion: 1 });
  const axes = (
    writes[0]!.profile as { axisValues: Array<{ importance: number }> }
  ).axisValues;
  expect(axes[1]!.importance).toBe(60);
});

test("a version conflict is reported without losing the draft", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT" ? json({ code: "conflict" }, 409) : json(saved),
    ),
  );
  vi.stubGlobal("crypto", { randomUUID: () => key });
  render(<CareerProfileWizard onSaved={vi.fn()} />, {
    wrapper: createQueryWrapper(),
  });
  await screen.findByText(/現在の確定版: 第1版/);
  for (let step = 0; step < 9; step += 1) next();
  fireEvent.click(screen.getByRole("button", { name: "保存する" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "他の画面で希望条件が更新されました",
  );
  expect(screen.getByRole("button", { name: "保存する" })).toBeEnabled();
});
