import { useEffect } from "react";
import type { ReactNode } from "react";
import { LoginPage } from "../features/auth/pages/LoginPage";
import { navigate, safeCmsDestination, useLocation } from "./routes";
import { useAuth } from "./useAuth";

export function AuthRouteBoundary({ children }: { children: ReactNode }) {
  const { session, isLoading } = useAuth();
  const location = useLocation();
  const pathname = location.split(/[?#]/)[0];
  const isLogin = /^\/login\/?$/.test(pathname);
  const intended = isLogin
    ? safeCmsDestination(new URLSearchParams(location.split("?")[1]?.split("#")[0]).get("redirect"))
    : safeCmsDestination(location);
  const target = isLoading ? null : session
    ? (isLogin ? intended ?? "/offers" : null)
    : (!isLogin ? `/login${intended ? `?redirect=${encodeURIComponent(intended)}` : ""}` : null);

  useEffect(() => {
    if (target) navigate(target, { replace: true });
  }, [target]);

  // Guard before mounting CMS children, including during session restoration.
  if (isLoading || target) return <div className="auth-loading" role="status" aria-live="polite">Carregando…</div>;
  if (isLogin) return <LoginPage />;
  return children;
}
