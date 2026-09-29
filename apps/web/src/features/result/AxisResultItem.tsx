import { useId, useState } from "react";
import { formatDateTime } from "../../lib/format-date";
import {
  axisNames,
  axisStatusLabels,
  safeSourceUrl,
  type AxisResult,
  type Evidence,
} from "./match-report";

type Props = {
  axis: AxisResult;
  targetLabel: string;
};

function EvidenceItem({ evidence }: { evidence: Evidence }) {
  const href = safeSourceUrl(evidence.sourceUrl);
  return (
    <li className="evidence-item">
      <blockquote>{evidence.quote}</blockquote>
      <p className="meta">
        出典:{" "}
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {evidence.sourceUrl}
          </a>
        ) : (
          <span>{evidence.sourceUrl}</span>
        )}
        <span className="evidence-date">
          取得日時: {formatDateTime(evidence.fetchedAt)}
        </span>
      </p>
    </li>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="bar-row">
      <span>{label}</span>
      <div className="track" aria-hidden="true">
        <span style={{ width: `${value}%` }} />
      </div>
      <span>{value}</span>
    </div>
  );
}

export function AxisResultItem({ axis, targetLabel }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const name = axisNames[axis.axisKey];

  return (
    <li className={`axis-result status-${axis.status}`}>
      <button
        type="button"
        className="axis-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <span className="axis-name">{name}</span>
          <span className="axis-status">{axisStatusLabels[axis.status]}</span>
        </span>
        <span className="meta">{open ? "閉じる" : "根拠を見る"}</span>
      </button>
      <div className="axis-bars">
        <Bar label="あなた" value={axis.preference} />
        {axis.observed !== null && (
          <Bar label={targetLabel} value={axis.observed} />
        )}
      </div>
      <div id={panelId} className="axis-evidence" hidden={!open}>
        {axis.status === "excluded" && (
          <p className="meta">重要度を0にしたため、比較から除いています。</p>
        )}
        {axis.evidence.length > 0 ? (
          <ul>
            {axis.evidence.map((evidence, index) => (
              <EvidenceItem key={index} evidence={evidence} />
            ))}
          </ul>
        ) : (
          axis.status !== "excluded" && (
            <p className="meta">公開情報からは根拠を確認できませんでした。</p>
          )
        )}
      </div>
    </li>
  );
}
