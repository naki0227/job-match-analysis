import type { JobOverview as JobOverviewData } from "@job-match/contracts";

type Props = { overview: JobOverviewData };

function unavailable(status: "unknown" | "conflicting"): string {
  return status === "conflicting"
    ? "記載が複数あり確認が必要"
    : "求人ページから確認できず";
}

function yen(amount: number): string {
  return amount % 10_000 === 0
    ? `${(amount / 10_000).toLocaleString("ja-JP")}万円`
    : `${amount.toLocaleString("ja-JP")}円`;
}

function salary(value: JobOverviewData["salary"]): string {
  if (value.status !== "known") return unavailable(value.status);
  if (value.currency !== "JPY" || value.period !== "year") {
    return `${value.minimum.toLocaleString()}〜${value.maximum.toLocaleString()} ${value.currency} / ${value.period}`;
  }
  return value.minimum === value.maximum
    ? `年収 ${yen(value.minimum)}`
    : `年収 ${yen(value.minimum)}〜${yen(value.maximum)}`;
}

const employmentLabels: Record<string, string> = {
  FULL_TIME: "正社員",
  PART_TIME: "パート・アルバイト",
  CONTRACTOR: "契約・業務委託",
  TEMPORARY: "有期・臨時",
  INTERN: "インターン",
};

function employment(value: JobOverviewData["employmentTypes"]): string {
  if (value.status !== "known") return unavailable(value.status);
  return value.values.map((item) => employmentLabels[item] ?? item).join(" / ");
}

function locations(value: JobOverviewData["locations"]): string {
  return value.status === "known"
    ? value.values.join(" / ")
    : unavailable(value.status);
}

function workStyle(overview: JobOverviewData): string {
  if (overview.fullRemote.status === "conflicting")
    return unavailable("conflicting");
  if (overview.fullRemote.status === "known" && overview.fullRemote.value) {
    return "フルリモート可";
  }
  if (
    overview.weeklyOfficeDays.status === "known" &&
    overview.weeklyOfficeDays.value > 0
  ) {
    return `ハイブリッド（週${overview.weeklyOfficeDays.value}日出社必須）`;
  }
  if (overview.fullRemote.status === "known" && !overview.fullRemote.value) {
    return "出社あり";
  }
  return overview.weeklyOfficeDays.status === "conflicting"
    ? unavailable("conflicting")
    : unavailable("unknown");
}

function flexibility(value: JobOverviewData["scheduleFlexibility"]): string {
  if (value.status !== "known") return unavailable(value.status);
  if (value.value === 100) return "高い（フルフレックス・裁量労働など）";
  if (value.value === 50) return "フレックス等の記載あり";
  return "固定勤務時間";
}

function techStack(value: JobOverviewData["techStack"]): string {
  return value.status === "known"
    ? value.values.join(" / ")
    : unavailable(value.status);
}

/** The page text a known fact was read from, when it was stored. */
function evidence(fact: { status: string; evidence?: string }) {
  return fact.status === "known" ? fact.evidence : undefined;
}

function workStyleEvidence(overview: JobOverviewData) {
  return overview.weeklyOfficeDays.status === "known" &&
    overview.weeklyOfficeDays.value > 0
    ? evidence(overview.weeklyOfficeDays)
    : evidence(overview.fullRemote);
}

export function JobOverview({ overview }: Props) {
  const items = [
    ["給与", salary(overview.salary), evidence(overview.salary)],
    [
      "雇用形態",
      employment(overview.employmentTypes),
      evidence(overview.employmentTypes),
    ],
    ["勤務地", locations(overview.locations), evidence(overview.locations)],
    ["働き方", workStyle(overview), workStyleEvidence(overview)],
    [
      "勤務時間",
      flexibility(overview.scheduleFlexibility),
      evidence(overview.scheduleFlexibility),
    ],
    [
      "技術スタック",
      techStack(overview.techStack),
      evidence(overview.techStack),
    ],
  ] as const;

  return (
    <section className="job-overview" aria-labelledby="job-overview-heading">
      <div className="section-heading">
        <h3 id="job-overview-heading">求人概要</h3>
        <p className="meta">
          まず求人そのものの条件を整理し、その後にあなたの希望と比較します。
        </p>
      </div>
      <dl className="job-overview-grid">
        {items.map(([label, value, source]) => (
          <div className="job-overview-item" key={label}>
            <dt>{label}</dt>
            <dd>
              {value}
              {source && (
                <span className="fact-evidence">
                  <span className="visually-hidden">原文: </span>
                  {source}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
