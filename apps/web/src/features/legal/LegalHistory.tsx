import { formatDateTime } from "../../lib/format-date";
import { useLegalStatus } from "./useLegalConsent";

const documentNames = {
  terms: "利用規約",
  privacy_policy: "プライバシーポリシー",
};
const actionNames = { accepted: "同意", acknowledged: "確認" };

/** The user's own record of which versions they accepted or acknowledged. */
export function LegalHistory() {
  const status = useLegalStatus();
  if (status.isPending) {
    return <p className="meta">確認履歴を読み込んでいます。</p>;
  }
  if (status.isError) {
    return (
      <p className="meta" role="alert">
        確認履歴を読み込めませんでした。時間をおいてもう一度お試しください。
      </p>
    );
  }
  const { terms, privacyPolicy, history } = status.data;
  return (
    <section aria-labelledby="legal-history-heading">
      <h3 id="legal-history-heading">
        利用規約・プライバシーポリシーの確認履歴
      </h3>
      <dl className="facts">
        <div>
          <dt>利用規約（現在 第{terms.version}版）</dt>
          <dd>
            {terms.recordedAt
              ? `${formatDateTime(terms.recordedAt)}に同意`
              : "未同意"}
          </dd>
        </div>
        <div>
          <dt>プライバシーポリシー（現在 第{privacyPolicy.version}版）</dt>
          <dd>
            {privacyPolicy.recordedAt
              ? `${formatDateTime(privacyPolicy.recordedAt)}に確認`
              : "未確認"}
          </dd>
        </div>
      </dl>
      {history.length > 0 && (
        <ul className="legal-history" aria-label="これまでの記録">
          {history.map((item) => (
            <li key={`${item.documentType}:${item.version}:${item.action}`}>
              {documentNames[item.documentType]} 第{item.version}版：
              {formatDateTime(item.recordedAt)}に{actionNames[item.action]}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
