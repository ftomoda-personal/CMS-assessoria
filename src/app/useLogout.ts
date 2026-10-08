import { useRef, useState } from "react";
import { supabase } from "../lib/supabase/client";
import { navigate } from "./routes";

/** Shared pending/error behavior for Navbar and blocked-access actions. */
export function useLogout() {
  const pendingRef = useRef(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);

  async function handleSignOut() {
    // Prevent duplicate requests, including the two Navbar action instances.
    if (pendingRef.current) return;
    pendingRef.current = true;
    setIsSigningOut(true);
    setSignOutError(false);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setSignOutError(true);
        return;
      }
      // AuthProvider receives SIGNED_OUT; the existing boundary guards history entries.
      navigate("/login", { replace: true });
    } catch {
      setSignOutError(true);
    } finally {
      pendingRef.current = false;
      setIsSigningOut(false);
    }
  }

  return { isSigningOut, signOutError, handleSignOut, dismissSignOutError: () => setSignOutError(false) };
}
