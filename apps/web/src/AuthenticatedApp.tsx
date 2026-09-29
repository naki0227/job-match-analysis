import { useState } from "react";
import { AppHeader, type Screen } from "./components/AppHeader";
import { Toast } from "./components/Toast";
import { useToast } from "./components/useToast";
import { AnalyzeScreen } from "./features/analysis/AnalyzeScreen";
import { useAnalysisRequest } from "./features/analysis/useAnalysisRequest";
import { AccessTokenProvider } from "./features/auth/access-token";
import { CareerProfileWizard } from "./features/career-profile/CareerProfileWizard";
import { useCareerProfile } from "./features/career-profile/useCareerProfile";
import { HistoryScreen } from "./features/history/HistoryScreen";
import { useAnalysisHistory } from "./features/history/useAnalysisHistory";
import { InsightsScreen } from "./features/insights/InsightsScreen";
import { OnboardingIntro } from "./features/onboarding/OnboardingIntro";
import { MatchDetailScreen } from "./features/result/MatchDetailScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { HomeScreen } from "./screens/HomeScreen";

type Props = {
  getAccessToken: () => Promise<string>;
  email: string | null;
  onSignOut: () => Promise<void>;
};

export function AuthenticatedApp(props: Props) {
  return (
    <AccessTokenProvider getAccessToken={props.getAccessToken}>
      <Screens {...props} />
    </AccessTokenProvider>
  );
}

function Screens({ getAccessToken, email, onSignOut }: Props) {
  const [screen, setScreen] = useState<Screen>("home");
  const [matchResultId, setMatchResultId] = useState<string | null>(null);
  const [onboardingSkipped, setOnboardingSkipped] = useState(false);
  const analysis = useAnalysisRequest({ getAccessToken });
  const history = useAnalysisHistory();
  const profile = useCareerProfile();
  const toast = useToast();
  const profileVersion = profile.isSuccess
    ? (profile.data?.profileVersion ?? null)
    : undefined;
  const editProfile = () => setScreen("profile");

  function analyze(url: string) {
    setScreen("analyze");
    analysis.submit(url);
  }

  function openMatch(id: string) {
    setMatchResultId(id);
    setScreen("match");
  }

  if (profileVersion === null && !onboardingSkipped && screen === "home") {
    return (
      <main className="shell">
        <OnboardingIntro
          onStart={editProfile}
          onSkip={() => setOnboardingSkipped(true)}
        />
      </main>
    );
  }

  return (
    <>
      <AppHeader
        current={screen}
        onNavigate={setScreen}
        initial={(email?.[0] ?? "?").toUpperCase()}
      />
      <main className="shell">
        {screen === "home" && (
          <HomeScreen
            profileVersion={profileVersion}
            history={history}
            onAnalyze={analyze}
            onEditProfile={editProfile}
            onShowHistory={() => setScreen("history")}
            onOpenMatch={openMatch}
          />
        )}
        {screen === "analyze" && (
          <AnalyzeScreen
            state={analysis.state}
            onSubmit={analyze}
            getAccessToken={getAccessToken}
            onEditProfile={editProfile}
          />
        )}
        {screen === "history" && (
          <HistoryScreen history={history} onOpen={openMatch} />
        )}
        {screen === "match" && matchResultId && (
          <MatchDetailScreen
            matchResultId={matchResultId}
            onBack={() => setScreen("history")}
          />
        )}
        {screen === "insights" && (
          <InsightsScreen onEditProfile={editProfile} />
        )}
        {screen === "settings" && (
          <SettingsScreen
            email={email}
            onEditProfile={editProfile}
            onSignOut={onSignOut}
          />
        )}
        {screen === "profile" && (
          <CareerProfileWizard
            onSaved={(version) => {
              toast.notify(`希望条件の第${version}版を保存しました`);
              setScreen("home");
            }}
          />
        )}
      </main>
      <Toast message={toast.message} />
    </>
  );
}
