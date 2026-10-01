import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { RoleStep } from "../src/features/career-profile/RoleStep";
import { roleCategories } from "../src/features/career-profile/role-catalog";

function Harness({ initial = [] as string[] }) {
  const [roles, setRoles] = useState(initial);
  return (
    <>
      <RoleStep roles={roles} onChange={setRoles} />
      <output aria-label="保存される職種">{JSON.stringify(roles)}</output>
    </>
  );
}

afterEach(cleanup);

const saved = () =>
  JSON.parse(screen.getByLabelText("保存される職種").textContent ?? "[]");

test("categories span occupations far beyond software engineering", () => {
  const names = roleCategories.map((item) => item.name);
  for (const expected of [
    "営業",
    "人事・採用",
    "医療・福祉",
    "教育",
    "販売・接客・サービス",
  ]) {
    expect(names).toContain(expected);
  }
  expect(
    roleCategories.flatMap((item) => item.examples).length,
  ).toBeGreaterThan(40);
});

test("a role is picked from a category, typed freely, and removed again", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "営業" }));
  fireEvent.click(
    within(screen.getByRole("group", { name: "営業の職種の例" })).getByRole(
      "button",
      { name: "法人営業" },
    ),
  );
  fireEvent.change(screen.getByLabelText("職種名"), {
    target: { value: "  介護士  " },
  });
  fireEvent.keyDown(screen.getByLabelText("職種名"), { key: "Enter" });
  fireEvent.change(screen.getByLabelText("職種名"), {
    target: { value: "法人営業" },
  });
  fireEvent.click(screen.getByRole("button", { name: "追加" }));
  expect(saved()).toEqual(["法人営業", "介護士"]);

  const selected = within(screen.getByRole("group", { name: "選んだ職種" }));
  fireEvent.click(selected.getByRole("button", { name: "法人営業" }));
  expect(saved()).toEqual(["介護士"]);
  expect(
    within(screen.getByRole("group", { name: "営業の職種の例" })).getByRole(
      "button",
      { name: "法人営業" },
    ),
  ).toHaveAttribute("aria-pressed", "false");
});

test("previously saved roles in any wording stay selected", () => {
  render(<Harness initial={["Backend Engineer", "採用担当"]} />);
  const selected = within(screen.getByRole("group", { name: "選んだ職種" }));
  expect(
    selected.getByRole("button", { name: "Backend Engineer" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(selected.getByRole("button", { name: "採用担当" })).toBeVisible();
  expect(screen.queryByRole("group", { name: /の職種の例$/ })).toBeNull();
});
