import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase/client";
import type { AuthorizationStatus } from "./useAuth";
import { AuthContext } from "./useAuth";

type SessionSnapshot = { session: Session | null; isLoading: boolean };
type MembershipResult = { snapshot: SessionSnapshot; attempt: number; status: AuthorizationStatus };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionSnapshot>({
    session: null,
    isLoading: true,
  });

  const [membership, setMembership] = useState<MembershipResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let receivedAuthEvent = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      receivedAuthEvent = true;
      setState({ session, isLoading: false });
    });

    async function restoreSession() {
      try {
        const { data, error } = await supabase.auth.getSession();
        // An Auth event is newer than this initial snapshot and must win.
        if (active && !receivedAuthEvent) {
          setState({ session: error ? null : data.session, isLoading: false });
          if (error) console.warn("Auth session initialization failed.");
        }
      } catch {
        if (active && !receivedAuthEvent) {
          setState({ session: null, isLoading: false });
          console.warn("Auth session initialization failed.");
        }
      }
    }

    void restoreSession();
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (state.isLoading || !state.session) return;
    let active = true;
    const controller = new AbortController();
    const userId = state.session.user.id;

    async function checkMembership() {
      try {
        const { data, error } = await supabase
          .from("cms_admins")
          .select("user_id")
          .eq("user_id", userId)
          .abortSignal(controller.signal)
          .maybeSingle();
        if (!active) return;
        setMembership({ snapshot: state, attempt,
          status: error ? "error" : data?.user_id === userId ? "authorized" : "unauthorized" });
      } catch {
        if (active) setMembership({ snapshot: state, attempt, status: "error" });
      }
    }

    // Run outside the synchronous Auth callback, using the existing browser client/RLS.
    void checkMembership();
    return () => {
      active = false;
      controller.abort();
    };
  }, [state, attempt]);

  // Every Auth event creates a new snapshot, even for the same user/token refresh.
  // Block in the render that observes it, before effects or old requests complete.
  const authorization: AuthorizationStatus = state.isLoading ? "checking" : !state.session
    ? "unauthenticated"
    : membership?.snapshot === state && membership.attempt === attempt ? membership.status : "checking";
  function retryAuthorization() {
    setAttempt(current => current + 1);
  }

  return <AuthContext.Provider value={{ ...state, user: state.session?.user ?? null, authorization, retryAuthorization }}>
    {children}
  </AuthContext.Provider>;
}
