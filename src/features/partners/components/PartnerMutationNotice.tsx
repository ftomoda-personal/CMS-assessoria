import { useCmsData } from "../../../app/useCmsData";
import { Button } from "@ftomoda/spectra-design-system";
export function PartnerMutationNotice() {
 const { partnerSubmissionFeedback, mutationState, refreshing, refreshFailed, partnerCreateBlocked, offerCreateBlocked, refreshData, status } = useCmsData();
 const messages = { idle: "", pending: "Salvando alteração…", rejected: "Alteração rejeitada ou não iniciada. Verifique os dados e sua autorização.", uncertain: "A operação pode ter sido salva. Repeti-la pode criar duplicatas. Não repita sem resolução segura.", confirmed: "Persistência da alteração confirmada.", "refresh-failed": "Persistência confirmada; atualização dos dados falhou. Não repita a operação." };
 return <>
 {partnerSubmissionFeedback && <p role="alert">{partnerSubmissionFeedback}</p>}
 {mutationState !== "idle" && <p role={mutationState === "pending" || mutationState === "confirmed" ? "status" : "alert"}>{messages[mutationState]}</p>}
 {(partnerCreateBlocked || offerCreateBlocked) && <p role="alert">Criação bloqueada por operação não resolvida ou proteção local indisponível. A operação pode ter sido salva; repetir pode criar duplicatas. Solicite resolução segura antes de continuar.</p>}
 {refreshing && <p role="status">Atualizando dados… Alterações temporariamente bloqueadas.</p>}
 {refreshFailed && <p role="alert">Falha ao atualizar dados completos. Dados exibidos são anteriores à falha; valores não salvos preservados. Alterações bloqueadas até atualização bem-sucedida.</p>}
 {(mutationState === "uncertain" || mutationState === "refresh-failed" || refreshFailed || partnerCreateBlocked || offerCreateBlocked) && <div>
  <Button type="button" variant="tertiary" disabled={mutationState === "pending" || Boolean(refreshing) || status === "loading"} onClick={() => { void refreshData(); }}>Atualizar somente a leitura</Button>
  {(mutationState === "uncertain" || partnerCreateBlocked || offerCreateBlocked) && <p>Esta atualização não confirma o resultado anterior nem libera uma operação incerta. Solicite análise ao responsável pelo CMS, informando a ação e o horário aproximado. Não apague as proteções locais nem repita o envio.</p>}
 </div>}
 </>;
}
