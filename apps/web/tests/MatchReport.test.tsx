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
  const job = screen.getByRole("region", { name: "働き方・仕事観の比較" });
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
  const job = screen.getByRole("region", { name: "働き方・仕事観の比較" });
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
  const job = screen.getByRole("region", { name: "働き方・仕事観の比較" });
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
  const overview = screen.getByRole("region", { name: "求人概要" });
  expect(overview).toHaveTextContent("給与年収 600万円〜1,600万円");
  expect(overview).toHaveTextContent("雇用形態正社員");
  expect(overview).toHaveTextContent("勤務地東京都 / 大阪府");
  expect(overview).toHaveTextContent("働き方ハイブリッド（週2日出社必須）");

  const constraints = screen.getByRole("list", {
    name: "希望条件との比較",
  });
  expect(constraints).toHaveTextContent("希望最低年収: 満たす");
  expect(constraints).toHaveTextContent(
    "希望勤務地: 判定できず（求人情報に記載なし）",
  );
  expect(constraints).toHaveTextContent("フルリモート必須: 満たさない");
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

test("the posting is read first, in its own words, before any comparison", () => {
  const report = {
    ...sampleReport,
    jobOverview: {
      ...sampleReport.jobOverview,
      salary: {
        status: "known" as const,
        minimum: 6_000_000,
        maximum: 16_000_000,
        currency: "JPY",
        period: "year",
        evidence: "給与 年収 600万円 〜 1600万円",
      },
      duties: {
        status: "known" as const,
        quotes: [
          { section: "業務内容", text: "各プロダクトのテックリード業務" },
          { section: "業務内容", text: "toB SaaSプロダクト開発" },
        ],
      },
      workStyle: {
        status: "known" as const,
        quotes: [
          {
            section: "働き方(出社・リモート)",
            text: "原則、週2出社必須・週3以上の出社推奨",
          },
        ],
      },
      requirements: {
        status: "known" as const,
        quotes: [
          { section: "求めるスキル・経験", text: "基礎的な英語力" },
          { section: "あると望ましいスキル・経験", text: "AIの開発経験" },
        ],
      },
    },
  };
  const { container } = render(<MatchReport report={report} />);
  const overview = screen.getByRole("region", { name: "求人概要" });
  expect(overview).toHaveTextContent("原文: 給与 年収 600万円 〜 1600万円");

  const duties = screen.getByRole("region", { name: "仕事内容・役割" });
  expect(
    within(duties).getByRole("heading", { name: "業務内容" }),
  ).toBeVisible();
  expect(within(duties).getAllByRole("listitem")).toHaveLength(2);
  const requirements = screen.getByRole("region", { name: "求める人物・経験" });
  expect(
    within(requirements).getByRole("heading", {
      name: "あると望ましいスキル・経験",
    }),
  ).toBeVisible();

  const order = [
    "求人概要",
    "仕事内容・役割",
    "働き方",
    "求める人物・経験",
    "希望条件との比較",
    "働き方・仕事観の比較",
  ].map((name) =>
    container.innerHTML.indexOf(screen.getByRole("region", { name }).outerHTML),
  );
  expect(order.every((position) => position >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("a report without posting sections says they could not be read", () => {
  render(<MatchReport report={sampleReport} />);
  expect(
    screen.getByRole("region", { name: "仕事内容・役割" }),
  ).toHaveTextContent("求人ページから確認できず");
});

test("a range axis shows the posting's range and is counted as 一部近い", () => {
  if (sampleReport.job.status !== "comparable") throw new Error("job");
  const axes = sampleReport.job.axes.map((axis) =>
    axis.axisKey === "role_breadth"
      ? {
          ...axis,
          status: "partial" as const,
          importance: 100,
          observed: null,
          observedRange: { minimum: 50 as const, maximum: 100 as const },
        }
      : axis,
  );
  render(
    <MatchReport
      report={{ ...sampleReport, job: { ...sampleReport.job, axes } }}
    />,
  );
  expect(screen.getByLabelText("求人の軸別の比較結果")).toHaveTextContent(
    "1一部近い",
  );
  const job = screen.getByRole("region", { name: "働き方・仕事観の比較" });
  const item = within(job).getByText("役割の幅").closest("li") as HTMLElement;
  expect(item).toHaveTextContent("一部近い");
  expect(item).toHaveTextContent("50〜100");
  expect(item).toHaveTextContent(/隣り合う2段階のどちらにも当てはまり/);
  expect(item).toHaveTextContent(/中間値を推定したものではありません/);
});
