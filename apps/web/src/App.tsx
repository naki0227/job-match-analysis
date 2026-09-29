import { useEffect, useState } from "react";
import { healthResponseSchema } from "@job-match/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { AuthenticatedApp } from "./AuthenticatedApp";
import {
  getCurrentAccessToken,
  getSupabaseClient,
  initializeOwnProfile,
  signOut,
  startGoogleSignIn,
} from "./features/auth/auth";
import { SignInScreen } from "./features/auth/SignInScreen";
import "./App.css";

function App() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>("loading");
  const [authStatus, setAuthStatus] = useState<
    "checking" | "signed_out" | "signed_in" | "error"
  >("checking");
  const [email, setEmail] = useState<string | null>(null);

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
        if (!active) return;
        setEmail(data.session.user.email ?? null);
        setAuthStatus("signed_in");
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

  async function handleSignOut() {
    await signOut(getSupabaseClient().auth);
    queryClient.clear();
    setEmail(null);
    setAuthStatus("signed_out");
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
        <AuthenticatedApp
          getAccessToken={getCurrentAccessToken}
          email={email}
          onSignOut={handleSignOut}
        />
      )}
      <footer className="api-status">API Status: {status}</footer>
    </div>
  );
}

export default App;
