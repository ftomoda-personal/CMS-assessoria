import { MutationError } from "../../lib/supabase/mutation.ts";
import type { PartnerWriteResult, PartnerDeleteResult } from "./supabaseWriteRepository";
import type { OfferWriteResult, OfferDeleteResult } from "../offers/supabaseWriteRepository";
export type PartnerMutationState = "idle" | "pending" | "rejected" | "uncertain" | "confirmed" | "refresh-failed";
/** UI orchestration only: the repository remains the sole mutation authority. */
export function createPartnerMutationController(deps: { valid(): Promise<boolean>; refresh(): Promise<boolean>; publish(state: PartnerMutationState): void; rejectionFeedback?(message: string): void }) {
 let pending = false;
 let sealed = false;
 let generation = 0;
 return {
  invalidate() { generation++; sealed = true; },
  async run(dispatch: () => Promise<PartnerWriteResult | PartnerDeleteResult | OfferWriteResult | OfferDeleteResult>) {
   if (pending || sealed) return;
   pending = true; const ticket = generation; deps.publish("pending");
   const valid = async () => ticket === generation && await deps.valid() && ticket === generation;
   try {
    if (!await valid()) return;
    const result = await dispatch();
    if (!await valid()) return;
    if (result.outcome === "uncertain") { sealed = true; deps.publish("uncertain"); return; }
    // Prevent redispatch after confirmed persistence, even when follow-up fails.
    sealed = true;
    let refreshed = false;
    try { refreshed = await deps.refresh(); } catch { /* Persistence remains confirmed. */ }
    if (!await valid()) return;
    deps.publish(refreshed ? "confirmed" : "refresh-failed");
    return result;
   } catch (error) {
    if (!await valid()) return;
    if (error instanceof MutationError && error.kind !== "uncertain") {
     const messages = {
      authorization: "Alteração não autorizada. Confirme seu acesso administrativo antes de uma nova tentativa.",
      domain: "Alteração rejeitada ou não iniciada. Revise os campos, datas e regras da operação. Para excluir uma oferta ativa, desabilite-a primeiro.",
      conflict: "Há um conflito com outra alteração. Atualize os dados e revise antes de decidir por um novo envio.",
      missing: "O registro não está disponível para esta operação. Atualize os dados e revise seu acesso.",
      response: "Não foi possível iniciar ou confirmar a rejeição da alteração. Revise os dados e as proteções locais.",
      cancelled: "Envio interrompido antes da gravação. Confirme sua sessão antes de decidir por um novo envio.",
      stale: "A sessão mudou antes da gravação. Confirme seu acesso e atualize os dados.",
     };
     deps.rejectionFeedback?.(messages[error.kind]);
    }
    deps.publish(error instanceof MutationError && error.kind === "uncertain" ? "uncertain" : "rejected");
   } finally { pending = false; }
  },
 };
}

/** Only synchronous entry checks; never classifies an already dispatched write. */
export function allowPartnerSubmission(state: {
 mutationState: PartnerMutationState; busy: boolean; authorized: boolean;
 ready: boolean; refreshing: boolean; refreshFailed: boolean; createBlocked: boolean;
}, notify: (message: string) => void): boolean {
 let message: string | undefined;
 if (state.busy || state.mutationState === "pending") message = "Há uma operação em andamento. Aguarde o resultado; não repita o envio.";
 else if (state.createBlocked || state.mutationState === "uncertain") message = "Envio bloqueado por operação não resolvida ou proteção indisponível. Uma operação anterior pode ter sido salva. Não repita sem resolução segura.";
 else if (state.mutationState === "refresh-failed") message = "Persistência anterior confirmada; atualização dos dados falhou. Não repita a operação.";
 else if (!state.authorized) message = "Esta tentativa não foi iniciada: acesso administrativo não confirmado.";
 else if (state.refreshing) message = "Esta tentativa não foi iniciada: os dados estão sendo atualizados. Aguarde a conclusão. Nenhum envio será feito automaticamente.";
 else if (!state.ready || state.refreshFailed) message = "Esta tentativa não foi iniciada: os dados completos não estão disponíveis. Aguarde uma atualização bem-sucedida. Nenhum envio será feito automaticamente.";
 if (message) { notify(message); return false; }
 return true;
}
