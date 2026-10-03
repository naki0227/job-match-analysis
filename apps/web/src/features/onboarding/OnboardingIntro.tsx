import { Mascot } from "../../components/Mascot";

type Props = {
  onStart: () => void;
  onSkip: () => void;
};

/** First visit without a saved profile: explain, then start the stepper. */
export function OnboardingIntro({ onStart, onSkip }: Props) {
  return (
    <section
      className="gate gate-onboarding"
      aria-labelledby="onboarding-heading"
    >
      <div className="gate-card">
        <div className="gate-mascot">
          <Mascot pose="wave" />
        </div>
        <div className="gate-copy">
          <div className="eyebrow">WELCOME</div>
          <h1 id="onboarding-heading">まずは、自分の軸から。</h1>
          <p className="sub">
            希望職種と8つの軸、譲れない条件を入力すると、求人の公開情報と比べられます。3分ほどで終わります。
          </p>
          <p className="sub">
            結果は採否や能力の判定ではなく、あなたの意思決定のための比較です。
          </p>
          <div className="actions">
            <button className="primary" type="button" onClick={onStart}>
              はじめる
            </button>
            <button className="text-btn" type="button" onClick={onSkip}>
              あとで
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
