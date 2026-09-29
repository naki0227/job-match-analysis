import { Mascot } from "../../components/Mascot";
import type { ShareCardData } from "./share-card";

/** On-screen version of the card; the same fields as the saved image. */
export function ShareCard({
  card,
  label,
}: {
  card: ShareCardData;
  label: string;
}) {
  return (
    <div className="share-preview">
      <div className="share-ribbon">
        <span className="dot" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="share-head">
        <div>
          <div className="share-brand">job match</div>
          <p className="share-company">{card.companyName}</p>
          <p className="meta">{card.jobTitle}</p>
        </div>
        <Mascot pose="success" size="small" />
      </div>
      <div className="share-grid">
        <div className="share-stat">
          <b>{card.close}</b>
          <span>近い</span>
        </div>
        <div className="share-stat">
          <b>{card.different}</b>
          <span>相違</span>
        </div>
        <div className="share-stat">
          <b>{card.unknown}</b>
          <span>不明</span>
        </div>
      </div>
      {card.closeAxes.length > 0 && (
        <div className="share-axes" aria-label="近い軸">
          {card.closeAxes.map((axis) => (
            <span key={axis}>{axis}</span>
          ))}
        </div>
      )}
      <p className="share-note">
        本名・メール・希望年収・希望勤務地・希望値は含めず、比較結果だけを共有します。
      </p>
    </div>
  );
}
