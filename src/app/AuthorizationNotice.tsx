import { Button, Toast } from "@ftomoda/spectra-design-system";
import { LogOut } from "lucide-react";
import { useAuth } from "./useAuth";
import { useLogout } from "./useLogout";
import "./authorization.css";

export function AuthorizationNotice({ failed }: { failed: boolean }) {
  const { retryAuthorization } = useAuth();
  const { isSigningOut, signOutError, handleSignOut, dismissSignOutError } = useLogout();

  return <main className="authorization-notice" aria-labelledby="authorization-title">
    <h1 id="authorization-title">{failed ? "Não foi possível verificar o acesso" : "Acesso não autorizado"}</h1>
    <p role={failed ? "alert" : undefined}>{failed
      ? "Tente novamente para verificar sua permissão de acesso ao CMS."
      : "Esta conta não tem permissão para acessar o CMS."}</p>
    <div className="authorization-notice-actions">
      {failed && <Button variant="primary" size="sm" disabled={isSigningOut} onClick={retryAuthorization}>Tentar novamente</Button>}
      <Button variant="secondary" size="sm" leadingIcon={<LogOut size={16} aria-hidden="true" />}
        disabled={isSigningOut} aria-busy={isSigningOut} onClick={() => void handleSignOut()}>
        {isSigningOut ? "Saindo…" : "Sair"}
      </Button>
    </div>
    {signOutError && <Toast variant="error" role="alert" title="Não foi possível sair" description="Tente novamente."
      closeLabel="Fechar aviso" onDismiss={dismissSignOutError} />}
  </main>;
}
