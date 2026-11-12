import { useRef, useState } from "react";
import { RecoveryScreen } from "../components/RecoveryScreen";
import type { RecoveryRequestAdapter, RequestOutcome } from "./adapter";
const messages: Partial<Record<RequestOutcome, string>> = {
  "invalid-email": "Informe um e-mail válido.",
  "rate-limit": "Muitas solicitações. Aguarde antes de tentar novamente.",
  rejected: "Não foi possível aceitar a solicitação. Tente mais tarde.",
  uncertain: "Não foi possível confirmar a solicitação. Ela não será repetida automaticamente. Confira suas instruções ou volte ao login.",
};
export function RecoveryRequest({ adapter, onBack }: { adapter?: RecoveryRequestAdapter; onBack(): void }) {
  const [outcome, setOutcome] = useState<RequestOutcome>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function request(email: string) {
    if (!adapter || pending.current || outcome === "uncertain") return;
    pending.current = true; setBusy(true); setOutcome(undefined);
    try { setOutcome(await adapter.request(email)); }
    catch { setOutcome("uncertain"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <RecoveryScreen view={outcome === "accepted" ? "requested" : "request"} busy={busy} submitDisabled={outcome === "uncertain"} message={outcome ? messages[outcome] : undefined} onBack={onBack} onRequest={adapter ? email => void request(email) : undefined} />;
}
