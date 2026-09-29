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
    let currentUserId: string | null = null;
    let generation = 0;
    let unsubscribe = () => {};
    try {
      const { data } = getSupabaseClient().auth.onAuthStateChange(
        (event, session) => {
          if (
            event !== "INITIAL_SESSION" &&
            session?.user.id === currentUserId
          ) {
            return;
          }
          currentUserId = session?.user.id ?? null;
          const ownGeneration = ++generation;
          queryClient.clear();
          setEmail(null);
          if (!session) {
            setAuthStatus("signed_out");
            return;
          }
          setAuthStatus("checking");
          // Supabase auth callbacks must stay synchronous; bootstrap afterwards.
          setTimeout(() => {
            if (!active || generation !== ownGeneration) return;
            void initializeOwnProfile(session.access_token)
              .then(() => {
                if (!active || generation !== ownGeneration) return;
                setEmail(session.user.email ?? null);
                setAuthStatus("signed_in");
              })
              .catch(() => {
                if (active && generation === ownGeneration)
                  setAuthStatus("error");
              });
          }, 0);
        },
      );
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      queueMicrotask(() => {
        if (active) setAuthStatus("error");
      });
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, [queryClient]);

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
