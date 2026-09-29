import { useState } from "react";

type Props = { onAccept: () => void };

/**
 * Terms and privacy acknowledgement. Recording it needs the legal history API
 * (Issue #38), so the app does not show it in the real flow yet.
 */
export function LegalConsent({ onAccept }: Props) {
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  return (
    <section className="gate" aria-labelledby="legal-heading">
      <div className="eyebrow">WELCOME</div>
      <h1 id="legal-heading">最初に確認。</h1>
      <div className="checklist">
        <label className="checkline">
          <input
            type="checkbox"
            checked={terms}
            onChange={(event) => setTerms(event.target.checked)}
          />
          <span>
            <strong>利用規約</strong> に同意する
          </span>
        </label>
        <label className="checkline">
          <input
            type="checkbox"
            checked={privacy}
            onChange={(event) => setPrivacy(event.target.checked)}
          />
          <span>
            <strong>プライバシーポリシー</strong> を確認した
          </span>
        </label>
      </div>
      <div className="actions">
        <button
          className="primary"
          type="button"
          disabled={!terms || !privacy}
          onClick={onAccept}
        >
          次へ
        </button>
      </div>
    </section>
  );
}
