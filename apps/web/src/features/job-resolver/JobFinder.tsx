import { useEffect, useRef } from "react";
import { JobSearchForm } from "./JobSearchForm";
import { ResolverResult } from "./ResolverResult";
import { useJobSearch } from "./useJobSearch";

type Props = {
  getAccessToken: () => Promise<string>;
  onAnalyze: (url: string) => void;
  fetcher?: typeof fetch;
};

const errorMessages = {
  invalid: "企業名と職種を100文字以内で入力してください。",
  unauthorized: "ログインし直してから、もう一度お試しください。",
  unavailable:
    "いまは求人を探せませんでした。時間をおくか、求人URLを直接入力してください。",
} as const;

/** Company + role → the posting to analyze (ADR-045). */
export function JobFinder({ getAccessToken, onAnalyze, fetcher }: Props) {
  const search = useJobSearch(getAccessToken, fetcher);
  const analyze = useRef(onAnalyze);
  useEffect(() => {
    analyze.current = onAnalyze;
  });

  // A clearly identified posting goes straight into the existing analysis,
  // once per search result.
  const { data } = search;
  useEffect(() => {
    if (data?.status === "resolved") analyze.current(data.candidate.url);
  }, [data]);

  const error = search.error as { kind?: keyof typeof errorMessages } | null;
  return (
    <div className="job-finder">
      <JobSearchForm busy={search.isPending} onSearch={search.mutate} />
      {search.data && (
        <ResolverResult result={search.data} onAnalyze={onAnalyze} />
      )}
      {error && (
        <p className="field-error" role="alert">
          {errorMessages[error.kind ?? "unavailable"]}
        </p>
      )}
    </div>
  );
}
