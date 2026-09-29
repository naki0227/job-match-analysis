import { useEffect, useState } from "react";
import { healthResponseSchema } from "@job-match/contracts";
import { AuthenticatedApp } from "./AuthenticatedApp";
import {
  getCurrentAccessToken,
  getSupabaseClient,
  initializeOwnProfile,
  startGoogleSignIn,
} from "./features/auth/auth";
import { SignInScreen } from "./features/auth/SignInScreen";
import "./App.css";

function App() {
  const [status, setStatus] = useState<string>("loading");
  const [authStatus, setAuthStatus] = useState<
    "checking" | "signed_out" | "signed_in" | "error"
  >("checking");

  useEffect(() => {
    async function checkHealth() {
      try {
        const response = await fetch("/api/health");
        if (!response.ok) throw new Error("Health unavailable");
        const data = healthResponseSchema.parse(await response.json());
        setStatus(data.status);
      } catch {
        setStatus("error");
      }
    }

    checkHealth();
  }, []);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        const { data, error } = await getSupabaseClient().auth.getSession();
        if (!active) return;
        if (error) {
          setAuthStatus("error");
          return;
        }
        if (!data.session) {
          setAuthStatus("signed_out");
          return;
        }
        await initializeOwnProfile(data.session.access_token);
        if (active) setAuthStatus("signed_in");
      } catch {
        if (active) setAuthStatus("error");
      }
    }
    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  async function handleGoogleSignIn() {
    try {
      await startGoogleSignIn(getSupabaseClient().auth, window.location.origin);
    } catch {
      setAuthStatus("error");
    }
  }

  return (
    <div className="app">
      {authStatus === "checking" && (
        <p className="api-status" role="status">
          読み込み中です。
        </p>
      )}
      {(authStatus === "signed_out" || authStatus === "error") && (
        <SignInScreen
          failed={authStatus === "error"}
          onSignIn={() => void handleGoogleSignIn()}
        />
      )}
      {authStatus === "signed_in" && (
        <AuthenticatedApp getAccessToken={getCurrentAccessToken} />
      )}
      <footer className="api-status">API Status: {status}</footer>
    </div>
  );
}

export default App;
