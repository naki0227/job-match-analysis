import type { LegalDocument } from "@job-match/contracts";

type Props = {
  title: string;
  document: LegalDocument;
  onClose: () => void;
};

/**
 * The stored Markdown is shown as plain text (no HTML rendering), so the
 * database text is exactly what the user reads and nothing can be injected.
 */
export function LegalDocumentView({ title, document, onClose }: Props) {
  const effective = new Date(document.effectiveAt).toLocaleDateString("ja-JP");
  return (
    <section
      className="panel legal-document"
      role="dialog"
      aria-modal="false"
      aria-labelledby="legal-document-title"
    >
      <h2 id="legal-document-title">{title}</h2>
      <p className="meta">
        第{document.version}版・{effective}から適用
      </p>
      <div className="legal-document-body" tabIndex={0}>
        {document.bodyMarkdown}
      </div>
      <div className="actions">
        <button className="secondary" type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
    </section>
  );
}
