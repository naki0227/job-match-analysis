import { Mascot } from "../../components/Mascot";
import { AxisResultItem } from "./AxisResultItem";
import {
  constraintLabels,
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
}: {
  title: string;
  description: string;
  target: TargetResult;
  targetLabel: string;
}) {
  return (
    <section className="target-section" aria-label={title}>
      <h2>{title}</h2>
      <p className="meta">{description}</p>
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
  const summary = summarizeTarget(report.job);
  const hasConflict = report.hardConstraints.some(
    (constraint) => constraint.status === "unmet",
  );

  return (
    <article className="match-report" aria-labelledby="match-report-heading">
      <div className="result-head">
        <div>
          <div className="eyebrow">MATCH RESULT</div>
          <h1 id="match-report-heading">{report.companyName}</h1>
          <p className="sub">{report.jobTitle}</p>
          {summary && (
            <p className="summary" aria-label="求人の軸別の比較結果">
              <span>
                <b>{summary.close}</b>近い
              </span>
              <span>
                <b>{summary.different}</b>相違
              </span>
              <span>
                <b>{summary.unknown}</b>不明
              </span>
            </p>
          )}
        </div>
        <div className="hero-visual">
          <Mascot pose={hasConflict ? "worried" : "success"} size="small" />
        </div>
      </div>

      <ul className="constraints" aria-label="必須条件">
        {report.hardConstraints.map((constraint) => (
          <li
            key={constraint.kind}
            className={`constraint-${constraint.status}`}
          >
            {constraintLabels[constraint.kind]}:{" "}
            <b>{constraintStatusLabels[constraint.status]}</b>
          </li>
        ))}
      </ul>
      {hasConflict && (
        <p className="notice warn">
          必須条件に合わない項目があります。軸が近くても、この点は相殺されません。
        </p>
      )}

      <TargetSection
        title="この求人について"
        description="この求人ページの記載だけを根拠にした比較です。"
        target={report.job}
        targetLabel="求人"
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
