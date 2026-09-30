import type { ReactNode } from "react";
import { Mascot } from "../../components/Mascot";
import { formatDateTime } from "../../lib/format-date";
import type { AnalysisState, RefreshStatus } from "./analysis-state";

type Props = {
  state: AnalysisState;
  onRetry: (url: string) => void;
  /** Personal comparison for a shared evaluation, shown after its status. */
  renderResult?: (evaluationId: string) => ReactNode;
};

const errorMessages = {
  invalid_url: null,
  unauthorized:
    "ログインの有効期限が切れました。再読み込みしてログインしてください。",
  not_found:
    "解析ジョブが見つかりませんでした。もう一度URLを送信してください。",
  quota_exceeded:
    "新しい求人の解析は、一定時間あたりの上限に達しました。解析済みの求人や分析済み企業は引き続き見られます。時間をおいて再度お試しください。",
  unavailable:
    "現在、解析を受け付けられません。時間をおいて再試行してください。",
} as const;

function refreshMessage(refresh: RefreshStatus): string {
  switch (refresh) {
    case "failed":
      return "最新情報の確認に失敗しました。取得日時の時点の情報であることに注意してください。";
    case "timeout":
      return "最新情報の確認に時間がかかっています。取得日時の時点の情報であることに注意してください。";
    default:
      return "求人内容が変わっている可能性があるため、最新の公開情報を確認しています。";
  }
}

function Steps({ running }: { running: boolean }) {
  return (
    <ol className="steps" aria-label="解析の進み具合">
      <li className="step done">受付済み</li>
      <li className={running ? "step active" : "step"}>
        公開ページを確認・整理
      </li>
      <li className="step">共有評価の完成</li>
    </ol>
  );
}

/** Shows shared job state; the personal comparison is rendered by the caller. */
export function AnalysisStatus({ state, onRetry, renderResult }: Props) {
  switch (state.kind) {
    case "idle":
    case "submitting":
      return null;
    case "waiting":
      return (
        <div className="analysis-status" role="status">
          <div className="stage-visual">
            <Mascot pose="search" />
          </div>
          <h2 className="stage-title">
            {state.progress === "running"
              ? "公開ページを確認しています"
              : "解析の順番を待っています"}
          </h2>
          <Steps running={state.progress === "running"} />
          <p className="sub centered">
            この画面を開いたまま待つと、完了時に表示が切り替わります。
          </p>
        </div>
      );
    case "ready":
      return (
        <>
          <div className="analysis-status" role="status">
            <div className="stage-visual">
              <Mascot pose="success" size="small" />
            </div>
            <h2 className="stage-title">
              {state.origin === "cache"
                ? "解析済みの共有評価が見つかりました"
                : "解析が完了しました"}
            </h2>
            <dl className="facts">
              <div>
                <dt>求人URL</dt>
                <dd className="url-text">{state.url}</dd>
              </div>
              {state.sourceFetchedAt && (
                <div>
                  <dt>公開情報の取得日時</dt>
                  <dd>{formatDateTime(state.sourceFetchedAt)}</dd>
                </div>
              )}
            </dl>
          </div>
          {renderResult?.(state.evaluationId)}
        </>
      );
    case "stale":
      return (
        <>
          <div className="analysis-status" role="status">
            <div className="stage-visual">
              <Mascot pose="point" size="small" />
            </div>
            <h2 className="stage-title">前回の解析結果があります</h2>
            <dl className="facts">
              <div>
                <dt>求人URL</dt>
                <dd className="url-text">{state.url}</dd>
              </div>
              <div>
                <dt>公開情報の取得日時</dt>
                <dd>{formatDateTime(state.sourceFetchedAt)}</dd>
              </div>
            </dl>
            <p className="notice warn">{refreshMessage(state.refresh)}</p>
            {(state.refresh === "failed" || state.refresh === "timeout") && (
              <div className="actions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => onRetry(state.url)}
                >
                  最新情報を再確認
                </button>
              </div>
            )}
          </div>
          {renderResult?.(state.evaluationId)}
        </>
      );
    case "failed":
      return (
        <div className="analysis-status" role="alert">
          <div className="stage-visual">
            <Mascot pose="sorry" size="small" />
          </div>
          <h2 className="stage-title">このページは解析できませんでした</h2>
          <p className="sub centered">
            ログイン不要で公開されている求人ページか確認してください。サイトの利用条件により取得しない場合もあります。
          </p>
          <div className="actions centered">
            <button
              className="secondary"
              type="button"
              onClick={() => onRetry(state.url)}
            >
              もう一度試す
            </button>
          </div>
        </div>
      );
    case "timeout":
      return (
        <div className="analysis-status" role="status">
          <div className="stage-visual">
            <Mascot pose="worried" size="small" />
          </div>
          <h2 className="stage-title">解析に時間がかかっています</h2>
          <p className="sub centered">
            解析は続いている可能性があります。少し時間をおいてから状態を確認してください。
          </p>
          <div className="actions centered">
            <button
              className="secondary"
              type="button"
              onClick={() => onRetry(state.url)}
            >
              状態を確認する
            </button>
          </div>
        </div>
      );
    case "error": {
      const message = errorMessages[state.reason];
      if (!message) return null;
      return (
        <p className="notice danger" role="alert">
          {message}
        </p>
      );
    }
  }
}
