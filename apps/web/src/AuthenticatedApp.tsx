import { useState } from "react";
import { AppHeader, type Screen } from "./components/AppHeader";
import { Toast } from "./components/Toast";
import { useToast } from "./components/useToast";
import { AnalyzeScreen } from "./features/analysis/AnalyzeScreen";
import { useAnalysisRequest } from "./features/analysis/useAnalysisRequest";
import { AccessTokenProvider } from "./features/auth/access-token";
import { CareerProfileWizard } from "./features/career-profile/CareerProfileWizard";
import { HomeScreen } from "./screens/HomeScreen";

type Props = { getAccessToken: () => Promise<string> };

export function AuthenticatedApp({ getAccessToken }: Props) {
  const [screen, setScreen] = useState<Screen>("home");
  const analysis = useAnalysisRequest({ getAccessToken });
  const toast = useToast();

  function analyze(url: string) {
    setScreen("analyze");
    analysis.submit(url);
  }

  return (
    <AccessTokenProvider getAccessToken={getAccessToken}>
      <AppHeader current={screen} onNavigate={setScreen} />
      <main className="shell">
        {screen === "home" && (
          <HomeScreen
            onAnalyze={analyze}
            onEditProfile={() => setScreen("profile")}
          />
        )}
        {screen === "analyze" && (
          <AnalyzeScreen
            state={analysis.state}
            onSubmit={analyze}
            getAccessToken={getAccessToken}
            onEditProfile={() => setScreen("profile")}
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
    </AccessTokenProvider>
  );
}
