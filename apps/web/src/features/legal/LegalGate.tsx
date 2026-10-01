import type { ReactNode } from "react";
import { LegalConsent } from "../onboarding/LegalConsent";
import { LegalApiError } from "./legal-api";
import {
  useAcknowledgeLegal,
  useCurrentLegalDocuments,
  useLegalStatus,
} from "./useLegalConsent";

type Props = {
  children: ReactNode;
  onSignOut: () => Promise<void>;
  fetcher?: typeof fetch;
};

function Unavailable({
  onRetry,
  onSignOut,
}: {
  onRetry: () => void;
  onSignOut: () => Promise<void>;
}) {
  return (
    <section className="gate" aria-labelledby="legal-unavailable-heading">
      <h1 id="legal-unavailable-heading">現在利用できません</h1>
      <p className="sub">
        利用規約とプライバシーポリシーを確認できないため、いまは利用を始められません。時間をおいてもう一度お試しください。
      </p>
      <div className="actions">
        <button className="primary" type="button" onClick={onRetry}>
          もう一度読み込む
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => void onSignOut()}
        >
          ログアウト
        </button>
      </div>
    </section>
  );
}

/**
 * Nothing behind this gate renders until the signed-in user has accepted the
 * current terms and acknowledged the current privacy policy. Missing or
 * unreadable documents fail closed with an explicit error, never a spinner
 * forever. Existing profiles and matches are untouched; the app continues
 * where it was once the user confirms.
 */
export function LegalGate({ children, onSignOut, fetcher }: Props) {
  const status = useLegalStatus(fetcher);
  const needsConsent = status.data?.complete === false;
  const documents = useCurrentLegalDocuments(needsConsent, fetcher);
  const acknowledge = useAcknowledgeLegal(fetcher);

  if (status.data?.complete) return <>{children}</>;
  if (status.isError || documents.isError) {
    return (
      <main className="shell">
        <Unavailable
          onRetry={() => {
            void status.refetch();
            if (needsConsent) void documents.refetch();
          }}
          onSignOut={onSignOut}
        />
      </main>
    );
  }
  if (!needsConsent || !documents.data) {
    return (
      <p className="api-status" role="status">
        読み込み中です。
      </p>
    );
  }
  const error =
    acknowledge.error instanceof LegalApiError &&
    acknowledge.error.kind === "outdated"
      ? "文書が更新されました。最新の内容を確認して、もう一度チェックしてください。"
      : acknowledge.isError
        ? "記録できませんでした。時間をおいてもう一度お試しください。"
        : null;
  return (
    <main className="shell">
      <LegalConsent
        key={`${documents.data.terms.id}:${documents.data.privacyPolicy.id}`}
        documents={documents.data}
        busy={acknowledge.isPending}
        error={error}
        onAccept={(ids) => acknowledge.mutate(ids)}
      />
    </main>
  );
}
