import { useEffect } from "react";
import type { ReactNode } from "react";
import { LoginPage } from "../features/auth/pages/LoginPage";
import { navigate, safeCmsDestination, useLocation } from "./routes";
import { useAuth } from "./useAuth";
import { AuthorizationNotice } from "./AuthorizationNotice";

export function AuthRouteBoundary({ children }: { children: ReactNode }) {
  const { authorization } = useAuth();
  const location = useLocation();
  const pathname = location.split(/[?#]/)[0];
  const isLogin = /^\/login\/?$/.test(pathname);
  const intended = isLogin
    ? safeCmsDestination(new URLSearchParams(location.split("?")[1]?.split("#")[0]).get("redirect"))
    : safeCmsDestination(location);
  const target = authorization === "authorized"
    ? (isLogin ? intended ?? "/offers" : null)
    : authorization === "unauthenticated" && !isLogin
      ? `/login${intended ? `?redirect=${encodeURIComponent(intended)}` : ""}` : null;

  useEffect(() => {
    if (target) navigate(target, { replace: true });
  }, [target]);

  // Guard before mounting CMS children, including during session restoration.
  if (authorization === "checking" || target) return <div className="auth-loading" role="status" aria-live="polite">Carregando…</div>;
  if (authorization === "unauthorized" || authorization === "error") return <AuthorizationNotice failed={authorization === "error"} />;
  if (authorization === "unauthenticated") return <LoginPage />;
  return children;
}
