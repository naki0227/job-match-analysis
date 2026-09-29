import { MatchSection } from "../result/MatchSection";
import type { AnalysisState } from "./analysis-state";
import { AnalysisStatus } from "./AnalysisStatus";
import { AnalyzeForm } from "./AnalyzeForm";
import "./analysis.css";

type Props = {
  state: AnalysisState;
  onSubmit: (url: string) => void;
  getAccessToken: () => Promise<string>;
  onEditProfile: () => void;
};

export function AnalyzeScreen({
  state,
  onSubmit,
  getAccessToken,
  onEditProfile,
}: Props) {
  const url = state.kind === "idle" ? "" : state.url;

  return (
    <section className="narrow page-head" aria-labelledby="analyze-heading">
      <div className="eyebrow">ANALYZE</div>
      <h1 id="analyze-heading">求人を分析</h1>
      <p className="sub">
        公開されている求人ページと、あなたの希望条件を照らし合わせます。結果は採否や能力の判定ではありません。
      </p>
      <div className="analyze-body">
        <AnalyzeForm
          key={url}
          initialUrl={url}
          busy={state.kind === "submitting"}
          invalid={state.kind === "error" && state.reason === "invalid_url"}
          onSubmit={onSubmit}
        />
        <AnalysisStatus
          state={state}
          onRetry={onSubmit}
          renderResult={(evaluationId) => (
            <MatchSection
              key={evaluationId}
              evaluationId={evaluationId}
              getAccessToken={getAccessToken}
              onEditProfile={onEditProfile}
            />
          )}
        />
      </div>
    </section>
  );
}
