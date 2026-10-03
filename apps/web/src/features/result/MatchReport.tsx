import { Mascot } from "../../components/Mascot";
import { ShareButton } from "../share/ShareButton";
import { AxisResultItem } from "./AxisResultItem";
import { JobOverview } from "./JobOverview";
import { PostingSection } from "./PostingSection";
import {
  constraintLabels,
  constraintReasonLabels,
  constraintStatusLabels,
  orderAxes,
  summarizeTarget,
  type MatchReportView,
  type TargetResult,
} from "./match-report";
import "./result.css";

type Props = { report: MatchReportView };

function TargetSection({
  title,
  description,
  target,
  targetLabel,
  showSummary = false,
}: {
  title: string;
  description: string;
  target: TargetResult;
  targetLabel: string;
  showSummary?: boolean;
}) {
  const summary = showSummary ? summarizeTarget(target) : null;
  return (
    <section className="target-section" aria-label={title}>
      <h3>{title}</h3>
      <p className="meta">{description}</p>
      {summary && (
        <p className="summary" aria-label="求人の軸別の比較結果">
          <span>
            <b>{summary.close}</b>近い
          </span>
          <span>
            <b>{summary.different}</b>相違
          </span>
          {summary.partial > 0 && (
            <span>
              <b>{summary.partial}</b>一部近い
            </span>
          )}
          <span>
            <b>{summary.unknown}</b>不明
          </span>
        </p>
      )}
      {target.status === "incompatible" ? (
        <p className="notice">
          評価時の軸の版があなたの希望条件と異なるため、比較していません。
        </p>
      ) : (
        <ul className="axis-results">
          {orderAxes(target.axes).map((axis) => (
            <AxisResultItem
              key={axis.axisKey}
              axis={axis}
              targetLabel={targetLabel}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Personal comparison for one job; never a hiring or personality verdict. */
export function MatchReport({ report }: Props) {
  const hasConflict = report.hardConstraints.some(
    (constraint) => constraint.status === "unmet",
  );
  const isOpenPosition = /オープンポジション|open position/iu.test(
    report.jobTitle,
  );

  return (
    <article className="match-report" aria-labelledby="match-report-heading">
      <div className="result-head">
        <div>
          <div className="eyebrow">MATCH RESULT</div>
          <h2 id="match-report-heading" className="report-title">
            {report.companyName}
          </h2>
          <p className="sub">{report.jobTitle}</p>
        </div>
        <div className="hero-visual">
          <Mascot pose={hasConflict ? "worried" : "success"} size="small" />
        </div>
      </div>

      {report.job.status === "comparable" && (
        <div className="actions">
          <ShareButton report={report} />
        </div>
      )}

      <JobOverview overview={report.jobOverview} />
      <PostingSection
        id="posting-duties"
        title="仕事内容・役割"
        section={report.jobOverview.duties}
      />
      <PostingSection
        id="posting-work-style"
        title="働き方"
        section={report.jobOverview.workStyle}
      />
      <PostingSection
        id="posting-requirements"
        title="求める人物・経験"
        section={report.jobOverview.requirements}
      />

      <section
        className="constraint-section"
        aria-labelledby="constraint-section-heading"
      >
        <h3 id="constraint-section-heading">希望条件との比較</h3>
        <p className="meta">
          ここは求人の条件そのものではなく、あなたが指定した必須条件との比較です。
        </p>
        <ul className="constraints" aria-label="希望条件との比較">
          {report.hardConstraints.map((constraint) => (
            <li
              key={constraint.kind}
              className={`constraint-${constraint.status}`}
            >
              {constraintLabels[constraint.kind]}:{" "}
              <b>{constraintStatusLabels[constraint.status]}</b>
              {constraint.reason && (
                <span className="constraint-reason">
                  （{constraintReasonLabels[constraint.reason]}）
                </span>
              )}
            </li>
          ))}
        </ul>
        {hasConflict && (
          <p className="notice warn">
            必須条件に合わない項目があります。8軸が近くても、この点は相殺されません。
          </p>
        )}
      </section>

      {isOpenPosition && (
        <p className="notice">
          この求人はオープンポジションのため、配属先によって変わる仕事観の項目は不明になりやすいです。給与・勤務地・働き方など、求人全体で明示された条件は上の「求人概要」に表示します。
        </p>
      )}

      <TargetSection
        title="働き方・仕事観の比較"
        description="求人ページから読み取れた範囲で、8軸をあなたの希望と比較します。"
        target={report.job}
        targetLabel="求人"
        showSummary
      />
      {report.company && (
        <TargetSection
          title="会社全体について（参考）"
          description="会社全体の公開情報です。この求人に当てはまるとは限りません。"
          target={report.company}
          targetLabel="会社"
        />
      )}

      <p className="notice">
        この結果は、あなたが入力した希望と公開情報の比較です。採否・能力・人柄を判定するものではありません。
      </p>
    </article>
  );
}
