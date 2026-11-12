import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

import type { CurrentAccount } from "../features/accounts/currentAccount.ts";

export type AuthorizationStatus = "checking" | "unauthenticated" | "authorized" | "student" | "unauthorized" | "error";

export type AuthState = {
  currentAccount: CurrentAccount | null;
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  authorization: AuthorizationStatus;
  retryAuthorization: () => void;
};

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth requires AuthProvider");
  return context;
}
