import { Mascot } from "../../components/Mascot";

type Props = {
  failed: boolean;
  onSignIn: () => void;
};

export function SignInScreen({ failed, onSignIn }: Props) {
  return (
    <section className="gate" aria-labelledby="sign-in-heading">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>job match</span>
      </div>
      <div className="gate-mascot">
        <Mascot pose="wave" />
      </div>
      <h1 id="sign-in-heading">はじめよう。</h1>
      <p className="sub">気になる求人を、自分の軸で。</p>
      <button className="google-btn" type="button" onClick={onSignIn}>
        <strong aria-hidden="true">G</strong>Googleでログイン
      </button>
      {failed && (
        <p className="notice danger" role="alert">
          認証を完了できませんでした。時間をおいてもう一度お試しください。
        </p>
      )}
    </section>
  );
}
