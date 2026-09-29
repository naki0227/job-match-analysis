import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { MatchReport } from "../src/features/result/MatchReport";
import { sampleReport } from "./fixtures/match-report";

afterEach(cleanup);

test("job and company results are shown in separate sections", () => {
  render(<MatchReport report={sampleReport} />);
  const job = screen.getByRole("region", { name: "この求人について" });
  const company = screen.getByRole("region", {
    name: "会社全体について（参考）",
  });
  const companyQuote = "全社でコアタイムのないフレックス制度を導入しています。";
  expect(within(job).getByText("裁量")).toBeInTheDocument();
  expect(within(job).queryByText(companyQuote)).not.toBeInTheDocument();
  expect(within(company).getByText(companyQuote)).toBeInTheDocument();
  expect(
    within(company).getByText(/この求人に当てはまるとは限りません/),
  ).toBeInTheDocument();
});

test("evidence shows the source link and fetch time", () => {
  render(<MatchReport report={sampleReport} />);
  const job = screen.getByRole("region", { name: "この求人について" });
  const toggle = within(job).getAllByRole("button", { name: /裁量/ })[0]!;
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(within(job).getByText("設計・技術選定にも参加します。")).toBeVisible();
  const link = within(job).getAllByRole("link")[0]!;
  expect(link).toHaveAttribute(
    "href",
    "https://jobs.example.com/sample-tech/backend",
  );
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(
    within(job).getAllByText(/取得日時: 2026年9月20日 10:02/)[0],
  ).toBeVisible();
});

test("axes without evidence say so instead of guessing", () => {
  render(<MatchReport report={sampleReport} />);
  const job = screen.getByRole("region", { name: "この求人について" });
  const openPanel = (name: RegExp) => {
    const toggle = within(job).getByRole("button", { name });
    fireEvent.click(toggle);
    return document.getElementById(toggle.getAttribute("aria-controls")!)!;
  };
  const unknown = openPanel(/顧客との接点/);
  expect(unknown).toBeVisible();
  expect(unknown).toHaveTextContent(
    "公開情報からは根拠を確認できませんでした。",
  );
  const excluded = openPanel(/仕事の変化/);
  expect(excluded).toHaveTextContent(
    "重要度を0にしたため、比較から除いています。",
  );
  expect(excluded).not.toHaveTextContent("根拠を確認できませんでした");
});

test("summary and hard constraints are shown without an overall score", () => {
  const { container } = render(<MatchReport report={sampleReport} />);
  expect(screen.getByLabelText("求人の軸別の比較結果")).toHaveTextContent(
    "1近い1相違5不明",
  );
  const constraints = screen.getByRole("list", { name: "必須条件" });
  expect(constraints).toHaveTextContent("最低年収: 満たす");
  expect(constraints).toHaveTextContent("勤務地: 不明（求人情報に記載なし）");
  expect(constraints).toHaveTextContent("フルリモート: 満たさない");
  expect(screen.getByText(/相殺されません/)).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/%|％|適性|合格/);
  expect(container.textContent).toMatch(
    /採否・能力・人柄を判定するものではありません/,
  );
});

test("incompatible axis versions are not compared", () => {
  render(
    <MatchReport
      report={{
        ...sampleReport,
        job: {
          status: "incompatible",
          evaluationId: sampleReport.job.evaluationId,
          evaluatedAt: sampleReport.job.evaluatedAt,
        },
        company: null,
      }}
    />,
  );
  expect(screen.getByText(/軸の版があなたの希望条件と異なる/)).toBeVisible();
  expect(
    screen.queryByLabelText("求人の軸別の比較結果"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "会社全体について（参考）" }),
  ).not.toBeInTheDocument();
});
