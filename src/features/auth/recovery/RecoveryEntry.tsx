import { useState, useSyncExternalStore } from "react";
import { Button } from "@ftomoda/spectra-design-system";
import { AuthSurface } from "../components/AuthSurface";
import { createRecoveryCoordinator } from "./coordinator";
import { recoveryIsolation } from "./browserIsolation";

export default function RecoveryEntry() {
  const [coordinator] = useState(() => createRecoveryCoordinator({ establish: async () => null, discardLocalSession: async () => { /* No recovery session can be created in this phase. */ } }, () => window.location.replace("/login"), recoveryIsolation.begin));
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.snapshot);
  return <AuthSurface recovery><section className="login-card recovery-card"><div className="recovery-content">
    <header className="login-intro"><h1>Recuperação de senha indisponível</h1><p>Este contexto não foi validado. Esta etapa não envia e-mails nem altera senhas.</p></header>
    <p role="status">O acesso ao CMS está bloqueado neste contexto. Para continuar, volte ao login e entre novamente com sua senha.</p>
    {state === "cleanup-failed" && <p role="alert">Não foi possível descartar o contexto local com segurança. O acesso permanece bloqueado.</p>}
    <Button disabled={state === "cleanup-failed"} onClick={() => void coordinator.leave()}>Voltar para o login</Button>
  </div></section></AuthSurface>;
}
