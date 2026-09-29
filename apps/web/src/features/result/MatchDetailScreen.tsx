import { useQuery } from "@tanstack/react-query";
import { useAccessToken } from "../auth/access-token-context";
import { MatchApiError, readStoredMatch } from "./match-api";
import { MatchReport } from "./MatchReport";

type Props = {
  matchResultId: string;
  onBack: () => void;
};

/** A stored match opened from the history list. */
export function MatchDetailScreen({ matchResultId, onBack }: Props) {
  const getAccessToken = useAccessToken();
  const match = useQuery({
    queryKey: ["stored-match", matchResultId],
    queryFn: async ({ signal }) =>
      readStoredMatch(await getAccessToken(), matchResultId, fetch, signal),
    staleTime: 60_000,
  });
  const notFound =
    match.error instanceof MatchApiError && match.error.kind === "not_found";

  return (
    <section className="page-head" aria-label="保存済みの比較結果">
      <button className="text-btn" type="button" onClick={onBack}>
        ‹ 分析済み企業へ戻る
      </button>
      {match.isPending && <p role="status">比較結果を読み込み中です。</p>}
      {match.isError && (
        <p className="notice danger" role="alert">
          {notFound
            ? "この比較結果は見つかりませんでした。"
            : "比較結果を読み込めませんでした。時間をおいて再試行してください。"}
        </p>
      )}
      {match.data && <MatchReport report={match.data} />}
    </section>
  );
}
