import { useState } from "react";
import { AppHeader, type Screen } from "./components/AppHeader";
import { AnalyzeScreen } from "./features/analysis/AnalyzeScreen";
import { useAnalysisRequest } from "./features/analysis/useAnalysisRequest";
import { CareerProfileForm } from "./features/career-profile/CareerProfileForm";
import { HomeScreen } from "./screens/HomeScreen";

type Props = { getAccessToken: () => Promise<string> };

export function AuthenticatedApp({ getAccessToken }: Props) {
  const [screen, setScreen] = useState<Screen>("home");
  const analysis = useAnalysisRequest({ getAccessToken });

  function analyze(url: string) {
    setScreen("analyze");
    analysis.submit(url);
  }

  return (
    <>
      <AppHeader current={screen} onNavigate={setScreen} />
      <main className="shell">
        {screen === "home" && (
          <HomeScreen
            onAnalyze={analyze}
            onEditProfile={() => setScreen("profile")}
          />
        )}
        {screen === "analyze" && (
          <AnalyzeScreen state={analysis.state} onSubmit={analyze} />
        )}
        {screen === "profile" && (
          <CareerProfileForm getAccessToken={getAccessToken} />
        )}
      </main>
    </>
  );
}
