import { useEffect } from "react";
import type { ReactNode } from "react";
import { LoginPage } from "../features/auth/pages/LoginPage";
import { navigate, safeCmsDestination, useLocation, studentPath } from "./routes";
import { useAuth } from "./useAuth";
import { useLogout } from "./useLogout";
import { AuthorizationNotice } from "./AuthorizationNotice";

function StudentEntry() {
  const { isSigningOut, signOutError, handleSignOut } = useLogout();
  return <main className="authorization-notice" aria-labelledby="student-title">
    <h1 id="student-title">Área do aluno</h1>
    <p>Sua conta está ativa. O catálogo de ofertas ainda não está disponível.</p>
    <button type="button" disabled={isSigningOut} onClick={() => void handleSignOut()}>{isSigningOut ? 'Saindo…' : 'Sair'}</button>
    {signOutError && <p role="alert">Não foi possível sair. Tente novamente.</p>}
  </main>;
}

export function AuthRouteBoundary({ children }: { children: ReactNode }) {
  const { authorization } = useAuth();
  const location = useLocation();
  const pathname = location.split(/[?#]/)[0];
  const isLogin = /^\/login\/?$/.test(pathname);
  const intended = isLogin
    ? safeCmsDestination(new URLSearchParams(location.split("?")[1]?.split("#")[0]).get("redirect"))
    : safeCmsDestination(location);
  const target = authorization === "student"
    ? (pathname !== studentPath ? studentPath : null)
    : authorization === "authorized"
    ? (pathname === studentPath ? "/offers" : isLogin ? intended ?? "/offers" : null)
    : authorization === "unauthenticated" && !isLogin
      ? `/login${intended ? `?redirect=${encodeURIComponent(intended)}` : ""}` : null;

  useEffect(() => {
    if (target) navigate(target, { replace: true });
  }, [target]);

  // Guard before mounting CMS children, including during session restoration.
  if (authorization === "checking" || target) return <div className="auth-loading" role="status" aria-live="polite">Carregando…</div>;
  if (authorization === "unauthorized" || authorization === "error") return <AuthorizationNotice failed={authorization === "error"} />;
  if (authorization === "unauthenticated") return <LoginPage />;
  if (authorization === "student") return <StudentEntry />;
  return children;
}
