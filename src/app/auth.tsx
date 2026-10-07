import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase/client";
import { AuthContext } from "./useAuth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ session: Session | null; isLoading: boolean }>({
    session: null,
    isLoading: true,
  });

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

  return <AuthContext.Provider value={{ ...state, user: state.session?.user ?? null }}>
    {children}
  </AuthContext.Provider>;
}
