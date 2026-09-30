import { toSharedMatch } from "@job-match/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AnalyzeScreen } from "../features/analysis/AnalyzeScreen";
import type { AnalysisState } from "../features/analysis/analysis-state";
import { AccessTokenProvider } from "../features/auth/access-token";
import { SignInScreen } from "../features/auth/SignInScreen";
import { CareerProfileWizard } from "../features/career-profile/CareerProfileWizard";
import { careerProfileQueryKey } from "../features/career-profile/useCareerProfile";
import { HistoryScreen } from "../features/history/HistoryScreen";
import { defaultHistoryFilter } from "../features/history/history-model";
import { InsightsScreen } from "../features/insights/InsightsScreen";
import { LegalConsent } from "../features/onboarding/LegalConsent";
import { OnboardingIntro } from "../features/onboarding/OnboardingIntro";
import { MatchDetailScreen } from "../features/result/MatchDetailScreen";
import { matchQueryKey } from "../features/result/useMatchReport";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { ShareDialog } from "../features/share/ShareDialog";
import { PublicShareView } from "../features/share/PublicShareView";
import { shareLinkQueryKey } from "../features/share/useShareLink";
import { createQueryClient } from "../lib/query-client";
import { HomeScreen } from "../screens/HomeScreen";
import { historyItems, sampleProfile, sampleReport } from "./fixtures";
import "./preview.css";

const url = "https://jobs.example.com/sample-tech/backend";
const jobId = "5d8f0a41-6b0e-4d8e-9f3a-1c2b3d4e5f60";
const evaluationId = sampleReport.job.evaluationId;
const noop = () => {};
const previewHistory = {
  status: "ready" as const,
  items: historyItems,
  hasMore: false,
  loadingMore: false,
  loadMore: noop,
};

function previewClient() {
  const client = createQueryClient();
  client.setQueryData(careerProfileQueryKey, sampleProfile);
  client.setQueryData(matchQueryKey(evaluationId), sampleReport);
  client.setQueryData(
    ["stored-match", sampleReport.matchResultId],
    sampleReport,
  );
  client.setQueryData(shareLinkQueryKey(sampleReport.matchResultId), {
    shareId: "7a1e2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b",
    token: "SampleShareToken_For-Preview-Only-000000000",
    sharedAt: "2026-09-29T01:00:00Z",
    projection: toSharedMatch(sampleReport),
  });
  return client;
}

const analysisStates: Record<string, AnalysisState> = {
  処理中: { kind: "waiting", url, jobId, progress: "running" },
  完了: {
    kind: "ready",
    url,
    evaluationId,
    origin: "job",
    sourceFetchedAt: null,
  },
  情報が古い: {
    kind: "stale",
    url,
    evaluationId,
    sourceFetchedAt: "2026-08-01T01:00:00Z",
    refreshJobId: jobId,
    refresh: "failed",
  },
  失敗: { kind: "failed", url, jobId },
  時間切れ: { kind: "timeout", url, jobId },
};

const screens: Record<string, () => ReactNode> = {
  サインイン: () => <SignInScreen failed={false} onSignIn={noop} />,
  利用規約の確認: () => <LegalConsent onAccept={noop} />,
  オンボーディング: () => <OnboardingIntro onStart={noop} onSkip={noop} />,
  ホーム: () => (
    <HomeScreen
      profileVersion={2}
      history={previewHistory}
      onAnalyze={noop}
      onEditProfile={noop}
      onShowHistory={noop}
      onOpenMatch={noop}
    />
  ),
  希望条件: () => <CareerProfileWizard onSaved={noop} />,
  ...Object.fromEntries(
    Object.entries(analysisStates).map(([label, state]) => [
      `求人分析：${label}`,
      () => (
        <AnalyzeScreen
          state={state}
          onSubmit={noop}
          getAccessToken={() => Promise.reject(new Error("preview"))}
          onEditProfile={noop}
        />
      ),
    ]),
  ),
  分析済み企業: () => (
    <HistoryScreen
      history={previewHistory}
      filter={defaultHistoryFilter}
      onFilterChange={noop}
      onOpen={noop}
    />
  ),
  比較結果の詳細: () => (
    <MatchDetailScreen
      matchResultId={sampleReport.matchResultId}
      onBack={noop}
    />
  ),
  インサイト: () => <InsightsScreen onEditProfile={noop} />,
  設定: () => (
    <SettingsScreen
      email="sample.user@example.com"
      onEditProfile={noop}
      onSignOut={async () => {}}
    />
  ),
  共有カード: () => <ShareDialog report={sampleReport} onClose={noop} />,
  公開ページ: () => (
    <PublicShareView
      share={{
        sharedAt: "2026-09-29T01:00:00Z",
        projection: toSharedMatch(sampleReport),
      }}
    />
  ),
};

/** Dev-only gallery of every screen with sample data (open /#ui-preview). */
export function UiPreview() {
  const [client] = useState(previewClient);
  const [selected, setSelected] = useState(Object.keys(screens)[0] ?? "");
  const render = screens[selected];

  return (
    <QueryClientProvider client={client}>
      <AccessTokenProvider
        getAccessToken={() => Promise.reject(new Error("preview"))}
      >
        <div className="app">
          <div className="preview-bar" role="note">
            <strong>開発用プレビュー</strong>
            <span>サンプルデータです。保存やAPI呼び出しは行いません。</span>
            <label>
              画面
              <select
                className="select"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                {Object.keys(screens).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
          </div>
          <main className="shell">{render?.()}</main>
        </div>
      </AccessTokenProvider>
    </QueryClientProvider>
  );
}
