import { useEffect, useRef } from "react";
import { JobSearchForm } from "./JobSearchForm";
import { ResolverResult } from "./ResolverResult";
import { useJobSearch, type JobSearchOptions } from "./useJobSearch";

type Props = {
  getAccessToken: () => Promise<string>;
  onAnalyze: (url: string) => void;
} & JobSearchOptions;

const errorMessages = {
  invalid: "企業名と職種を100文字以内で入力してください。",
  unauthorized: "ログインし直してから、もう一度お試しください。",
  rate_limited:
    "短時間に検索が続いたため、しばらく検索できません。求人URLを直接入力することはできます。",
  unavailable:
    "いまは求人を探せませんでした。時間をおくか、求人URLを直接入力してください。",
} as const;

/** Company (+ role) → the posting to analyze (ADR-045, ADR-047). */
export function JobFinder({ getAccessToken, onAnalyze, ...options }: Props) {
  const search = useJobSearch(getAccessToken, options);
  const analyze = useRef(onAnalyze);
  useEffect(() => {
    analyze.current = onAnalyze;
  });

  // A clearly identified posting goes straight into the existing analysis,
  // once per result. A company-only search never resolves to one posting.
  const { result } = search;
  useEffect(() => {
    if (result?.status === "resolved") analyze.current(result.candidate.url);
  }, [result]);

  const error = search.error as { kind?: keyof typeof errorMessages } | null;
  return (
    <div className="job-finder">
      <JobSearchForm
        busy={search.busy || search.searching}
        onSearch={search.search}
      />
      {search.searching && (
        <p role="status">
          Web上の公開求人を探して、求人ページか確かめています。数十秒かかることがあります。
        </p>
      )}
      {search.timedOut && (
        <p role="status">
          時間内に見つけられませんでした。少し後にもう一度探すか、求人URLを直接入力してください。
        </p>
      )}
      {result && result.status !== "searching" && (
        <ResolverResult result={result} onAnalyze={onAnalyze} />
      )}
      {error && (
        <p className="field-error" role="alert">
          {errorMessages[error.kind ?? "unavailable"]}
        </p>
      )}
    </div>
  );
}
