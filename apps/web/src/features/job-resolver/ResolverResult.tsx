import type { JobCandidateView, JobSearchResponse } from "@job-match/contracts";

type Props = {
  result: JobSearchResponse;
  onAnalyze: (url: string) => void;
};

const sourceLabels: Record<string, string> = {
  official: "企業の採用ページ",
  ats: "企業の採用管理サービス",
  known: "解析済みの求人",
  web: "公開求人ページ",
};

function CandidateCard({
  candidate,
  onAnalyze,
}: {
  candidate: JobCandidateView;
  onAnalyze: (url: string) => void;
}) {
  return (
    <li className="panel candidate-card">
      <strong>{candidate.title}</strong>
      <span className="muted">
        {candidate.companyName}・
        {sourceLabels[candidate.source] ?? "公開求人ページ"}
        {candidate.location ? `・${candidate.location}` : ""}
      </span>
      <a href={candidate.url} target="_blank" rel="noopener noreferrer">
        求人ページを開く
      </a>
      <button
        className="secondary"
        type="button"
        onClick={() => onAnalyze(candidate.url)}
      >
        この求人を分析する
      </button>
    </li>
  );
}

/**
 * Shows what the resolver found for the user's own company and role. It is
 * not a recommendation: the user decides which posting to analyze.
 */
export function ResolverResult({ result, onAnalyze }: Props) {
  return (
    <section className="resolver-result" aria-label="求人の検索結果">
      {result.status === "resolved" && (
        <>
          <p role="status">この求人を分析しています。</p>
          <ul className="candidate-list">
            <CandidateCard candidate={result.candidate} onAnalyze={onAnalyze} />
          </ul>
          <p className="muted">
            違う求人の場合は、下の「求人URLを直接入力」から指定してください。
          </p>
        </>
      )}
      {result.status === "candidates" && (
        <>
          <p role="status">
            {result.candidates.length}
            件の求人が見つかりました。分析する求人を選んでください。
          </p>
          <ul className="candidate-list" aria-label="求人の候補">
            {result.candidates.map((candidate) => (
              <CandidateCard
                key={candidate.url}
                candidate={candidate}
                onAnalyze={onAnalyze}
              />
            ))}
          </ul>
          {result.hasMore && (
            <p className="muted">
              ほかにも求人があります。職種を入れると絞り込めます。
            </p>
          )}
        </>
      )}
      {result.status === "not_found" && (
        <p role="status">
          この企業の求人を自動で取得できませんでした。求人が公開されていても、サイトによっては検索に対応できない場合があります。求人URLを直接入力すると分析できます。
        </p>
      )}
      {result.partial && (
        <p className="muted">
          一部の探し先に接続できなかったため、結果が不完全な場合があります。
        </p>
      )}
    </section>
  );
}
