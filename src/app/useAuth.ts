import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

export type AuthState = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
};

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth requires AuthProvider");
  return context;
}
