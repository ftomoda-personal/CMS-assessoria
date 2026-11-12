import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RecoveryScreen } from "../components/RecoveryScreen";
import type { RecoveryView } from "../components/RecoveryScreen";
import type { RecoveryAdapter } from "./adapter";
import type { createRecoveryCoordinator } from "./coordinator";

/** Composition has no transport/config lookup and cannot enable real recovery. */
export function RecoveryFlow({ adapter, coordinator }: { adapter: Pick<RecoveryAdapter, "issue">; coordinator: ReturnType<typeof createRecoveryCoordinator> }) {
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.snapshot);
  const [checked, setChecked] = useState(false);
  const verification = useRef<Promise<void> | null>(null);
  useEffect(() => {
    verification.current ??= coordinator.establish();
    let active = true;
    void verification.current.then(() => { if (active) setChecked(true); });
    return () => { active = false; };
  }, [coordinator]);
  let view: RecoveryView = "password", message: string | undefined;
  if (state === "unverified") {
    const issue = adapter.issue();
    view = !checked ? "verifying" : issue === "expired" ? "expired" : ["network", "rate-limit"].includes(issue ?? "") ? "network" : "invalid";
    if (issue === "network") message = "A conexão falhou. Não foi possível confirmar o link; nenhuma verificação será repetida automaticamente. Solicite novas instruções se necessário.";
    if (issue === "rate-limit") message = "Muitas tentativas de validação. Aguarde e solicite novas instruções.";
  } else if (state === "uncertain" && adapter.issue() === "expired") { view = "expired"; message = "O contexto expirou antes do envio da nova senha. Nenhuma alteração foi enviada. Solicite novas instruções."; }
  else if (state === "uncertain") { view = "uncertain"; message = "A alteração não foi confirmada. Nenhuma nova tentativa será feita neste contexto. Descarte a recuperação e tente entrar com sua senha; se necessário, solicite novas instruções."; }
  else if (["cleaning", "cleanup-failed", "login-required"].includes(state)) { view = "cleanup"; message = state === "cleanup-failed" ? "Não foi possível concluir a limpeza local. O acesso permanece bloqueado. Tente finalizar a limpeza, sem repetir a alteração da senha." : "Descartando o contexto de recuperação. Será necessário entrar novamente com sua senha."; }
  else if (adapter.issue()) message = adapter.issue() === "policy" ? "A senha não foi aceita pela política de segurança. Revise os requisitos e escolha outra senha." : adapter.issue() === "rate-limit" ? "Muitas tentativas. Aguarde antes de enviar novamente." : "A alteração foi rejeitada. Revise os dados antes de tentar novamente.";
  const busy = !checked || ["updating", "cleaning", "login-required"].includes(state);
  return <RecoveryScreen view={view} busy={busy} message={message} onReset={password => void coordinator.update(password)} onBack={() => void (["uncertain", "cleanup-failed"].includes(state) ? coordinator.discardAndLeave() : coordinator.leave())} />;
}
