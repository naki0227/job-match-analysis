import type { CurrentLegalDocuments } from "@job-match/contracts";
import { useState } from "react";
import { LegalDocumentView } from "../legal/LegalDocumentView";

type Props = {
  documents: CurrentLegalDocuments;
  busy?: boolean;
  /** Shown when the text changed while the user was reading, or saving failed. */
  error?: string | null;
  onAccept: (documents: {
    termsDocumentId: string;
    privacyPolicyDocumentId: string;
  }) => void;
};

/**
 * Terms (accepted) and privacy policy (acknowledged), ADR-022/046. The
 * versions shown here are the ones recorded, so a later version always
 * needs a new confirmation.
 */
export function LegalConsent({
  documents,
  busy = false,
  error,
  onAccept,
}: Props) {
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [reading, setReading] = useState<"terms" | "privacy" | null>(null);
  return (
    <section className="gate" aria-labelledby="legal-heading">
      <div className="eyebrow">WELCOME</div>
      <h1 id="legal-heading">最初に確認。</h1>
      <p className="sub">
        利用を始める前に、利用規約とプライバシーポリシーをお読みください。
      </p>
      <div className="checklist">
        <div className="legal-row">
          <label className="checkline">
            <input
              type="checkbox"
              checked={terms}
              onChange={(event) => setTerms(event.target.checked)}
            />
            <span>
              <strong>利用規約</strong>（第{documents.terms.version}
              版）に同意する
            </span>
          </label>
          <button
            className="legal-link"
            type="button"
            onClick={() => setReading("terms")}
          >
            利用規約を読む
          </button>
        </div>
        <div className="legal-row">
          <label className="checkline">
            <input
              type="checkbox"
              checked={privacy}
              onChange={(event) => setPrivacy(event.target.checked)}
            />
            <span>
              <strong>プライバシーポリシー</strong>（第
              {documents.privacyPolicy.version}版）を確認した
            </span>
          </label>
          <button
            className="legal-link"
            type="button"
            onClick={() => setReading("privacy")}
          >
            プライバシーポリシーを読む
          </button>
        </div>
      </div>
      {reading && (
        <LegalDocumentView
          title={reading === "terms" ? "利用規約" : "プライバシーポリシー"}
          document={
            reading === "terms" ? documents.terms : documents.privacyPolicy
          }
          onClose={() => setReading(null)}
        />
      )}
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button
          className="primary"
          type="button"
          disabled={!terms || !privacy || busy}
          onClick={() =>
            onAccept({
              termsDocumentId: documents.terms.id,
              privacyPolicyDocumentId: documents.privacyPolicy.id,
            })
          }
        >
          {busy ? "記録しています…" : "次へ"}
        </button>
      </div>
    </section>
  );
}
