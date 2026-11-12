import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase/client";
import type { AuthorizationStatus } from "./useAuth";
import { AuthContext } from "./useAuth";
import { recoveryIsolation, subscribeRecoveryIsolation } from "../features/auth/recovery/browserIsolation";
import { recoveryPath } from "../features/auth/recovery/entry";
import { navigate } from "./routes";
import { loadCurrentAccount } from "../lib/cms/currentAccountClient.ts";
import { currentAccountArea } from "../features/accounts/currentAccount.ts";
import type { CurrentAccount } from "../features/accounts/currentAccount.ts";

type SessionSnapshot = { session: Session | null; isLoading: boolean };
type AccountResult = { snapshot: SessionSnapshot; attempt: number; status: AuthorizationStatus; account: CurrentAccount | null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const isolationVersion = useSyncExternalStore(subscribeRecoveryIsolation, recoveryIsolation.snapshot);
  const [state, setState] = useState<SessionSnapshot>({
    session: null,
    isLoading: true,
  });

  const [accountResult, setAccountResult] = useState<AccountResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let receivedAuthEvent = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      receivedAuthEvent = true;
      if (event === "PASSWORD_RECOVERY") {
        recoveryIsolation.begin();
        setState({ session: null, isLoading: false });
        navigate(recoveryPath, { replace: true });
        return;
      }
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
    if (state.isLoading || !state.session || !recoveryIsolation.allows(state.session)) return;
    let active = true;
    const controller = new AbortController();
    const userId = state.session.user.id;

    async function checkCurrentAccount() {
      const result = await loadCurrentAccount(state.session!.access_token, userId, controller.signal);
      if (!active || controller.signal.aborted || !recoveryIsolation.allows(state.session)) return;
      const account = result.kind === 'current' ? result.account : null;
      const area = currentAccountArea(account);
      const status: AuthorizationStatus = result.kind === 'current'
        ? area === 'administrator' ? 'authorized' : area === 'student' ? 'student' : 'error'
        : result.kind === 'unauthenticated' ? 'unauthenticated'
        : result.kind === 'forbidden' ? 'unauthorized' : 'error';
      setAccountResult({ snapshot: state, attempt, status, account });
    }

    // Account authority comes from the backend, never JWT metadata/self-membership.
    void checkCurrentAccount();
    return () => {
      active = false;
      controller.abort();
    };
  }, [state, attempt, isolationVersion]);

  useEffect(() => {
    if (isolationVersion.startsWith("normal|")) return;
    if (!recoveryIsolation.allows(state.session)) void supabase.auth.stopAutoRefresh?.();
    else if (state.session) void supabase.auth.startAutoRefresh?.();
  }, [isolationVersion, state.session]);

  useEffect(() => subscribeRecoveryIsolation(() => {
    if (!recoveryIsolation.allows(state.session)) void supabase.auth.stopAutoRefresh?.();
  }), [state.session]);

  // Every Auth event creates a new snapshot, even for the same user/token refresh.
  // Block in the render that observes it, before effects or old requests complete.
  const admitted = recoveryIsolation.allows(state.session);
  const authorization: AuthorizationStatus = state.isLoading ? "checking" : !state.session || !admitted
    ? "unauthenticated"
    : accountResult?.snapshot === state && accountResult.attempt === attempt ? accountResult.status : "checking";
  function retryAuthorization() {
    setAttempt(current => current + 1);
  }

  const currentAccount = admitted && accountResult?.snapshot === state && accountResult.attempt === attempt
    && (authorization === 'authorized' || authorization === 'student') ? accountResult.account : null;
  return <AuthContext.Provider value={{ ...state, currentAccount, session: admitted ? state.session : null, user: admitted ? state.session?.user ?? null : null, authorization, retryAuthorization }}>
    {children}
  </AuthContext.Provider>;
}
