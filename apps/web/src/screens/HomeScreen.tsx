import { Mascot } from "../components/Mascot";
import { AnalyzeForm } from "../features/analysis/AnalyzeForm";
import "../features/analysis/analysis.css";

type Props = {
  onAnalyze: (url: string) => void;
  onEditProfile: () => void;
};

export function HomeScreen({ onAnalyze, onEditProfile }: Props) {
  return (
    <section aria-labelledby="home-heading">
      <div className="hero">
        <div>
          <div className="eyebrow">CAREER MATCH</div>
          <h1 id="home-heading">
            気になる求人を、
            <br />
            自分の軸で。
          </h1>
          <p className="sub">
            近い・違う・まだ分からない。公開情報を根拠に確かめます。
          </p>
        </div>
        <div className="hero-visual">
          <Mascot pose="laptop" />
        </div>
      </div>
      <AnalyzeForm busy={false} invalid={false} onSubmit={onAnalyze} />
      <div className="slim">
        <div>
          <strong>希望条件（Career Profile）</strong>
          <p className="meta">8つの軸と必須条件を、いつでも見直せます。</p>
        </div>
        <button className="text-btn" type="button" onClick={onEditProfile}>
          見直す
        </button>
      </div>
    </section>
  );
}
