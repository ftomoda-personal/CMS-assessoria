import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Input, StatusBadge } from "@ftomoda/spectra-design-system";
import { Save, Trash2, X } from "lucide-react";
import { mapPartnerList } from "../mappers";
import type { PersistedPartner } from "../mappers";
import { useCmsData } from "../../../app/useCmsData";
import { navigate } from "../../../app/routes";
import { PageHeader } from "../../../components/PageHeader";
import { PartnerLogoPlaceholder } from "./PartnerLogoPlaceholder";
import { PartnerMutationNotice } from "./PartnerMutationNotice";
import "../create-partner.css";

export type PartnerNotice = { partnerId: string; variant: "success"; title: string; description: string };
export function PartnerForm({ partner }: { partner?: PersistedPartner; onSaved: (notice: PartnerNotice) => void }) {
  const [name, setName] = useState(partner?.name ?? "");
  const [website, setWebsite] = useState(partner?.website ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [touched, setTouched] = useState({ name: false, website: false });
  const { mutatePartner, partnerCreateBlocked, mutationState, status, refreshing, refreshFailed, offers } = useCmsData();
  const disabled = (!partner && partnerCreateBlocked) || Boolean(refreshing || refreshFailed) || status !== "ready" || !["idle", "rejected", "confirmed"].includes(mutationState);
  const canDelete = partner && !partner.everAssociated && !offers.some(offer => offer.partnerId === partner.id);
  const details = partner ? mapPartnerList([partner], offers)[0] : undefined;
  const deletionUnresolved = ["pending", "uncertain", "refresh-failed"].includes(mutationState);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const deletionFeedback = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const websiteInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (confirmDelete && deletionUnresolved) deletionFeedback.current?.focus({ preventScroll: true });
  }, [confirmDelete, deletionUnresolved]);

  function changeDeleteOpen(open: boolean) {
    if (!open && deletionUnresolved) return;
    setConfirmDelete(open);
  }

  return <section className={`partner-form partner-form--${partner ? "edit" : "create"}`}>
    <PageHeader title={partner ? "EDITAR PARCEIRO" : "ADICIONAR PARCEIRO"} />
    <form aria-label={partner ? "Editar parceiro" : "Adicionar parceiro"} aria-busy={mutationState === "pending"} onSubmit={event => {
      event.preventDefault();
      if (name.trim() && website.trim()) void mutatePartner(partner ? "update" : "create", partner?.id, { name: name.trim(), website: website.trim() });
      else {
        setTouched({ name: true, website: true });
        (!name.trim() ? nameInput : websiteInput).current?.focus();
      }
    }}>
      <div className="partner-form-grid">
        {details && <section className="partner-form-panel" aria-label="Informações do parceiro">
          <div className="partner-form-status"><span>Status:</span><StatusBadge variant={details.status === "active" ? "success" : "error"}>{details.status === "active" ? "Ativo" : "Inativo"}</StatusBadge></div>
          <div className="partner-form-counts"><span>Ofertas:</span><dl><div><dt>Totais</dt><dd>{details.totalOffers}</dd></div><div><dt>Ativas</dt><dd>{details.activeOffers}</dd></div></dl></div>
          <div className="partner-form-delete"><p id="partner-delete-rule">Parceiro só pode ser excluído se nunca foi associado a uma oferta.</p><Button type="button" variant="destructive" size="sm" aria-describedby="partner-delete-rule" disabled={disabled || !canDelete} onClick={() => setConfirmDelete(true)}>Excluir parceiro</Button></div>
        </section>}
        <div className="partner-form-fields">
          <Input ref={nameInput} label="Nome" name="name" required value={name} placeholder="ex: Nubank" disabled={disabled} validationState={touched.name && !name.trim() ? "error" : "default"} errorMessage="Informe o nome do parceiro." onBlur={() => setTouched(current => ({ ...current, name: true }))} onChange={event => setName(event.target.value)} />
          <Input ref={websiteInput} label="Link" name="website" required value={website} placeholder="ex: nubank.com.br" disabled={disabled} validationState={touched.website && !website.trim() ? "error" : "default"} errorMessage="Informe o site do parceiro." onBlur={() => setTouched(current => ({ ...current, website: true }))} onChange={event => setWebsite(event.target.value)} />
          <PartnerLogoPlaceholder partner={partner} />
        </div>
      </div>
      <div className="partner-form-actions">
        <Button type="button" variant="tertiary" leadingIcon={<X size={16} />} disabled={disabled} onClick={() => navigate("/partners")}>Cancelar</Button>
        <Button type="submit" disabled={disabled || !name.trim() || !website.trim()} leadingIcon={<Save size={16} />}>Salvar</Button>
      </div>
    </form>
    <Dialog open={confirmDelete} onOpenChange={changeDeleteOpen} title="Excluir parceiro?" description={`Excluir permanentemente o parceiro “${partner?.name ?? ""}”? Esta ação não pode ser desfeita.`} role="alertdialog" closeLabel="Fechar confirmação de exclusão" initialFocusRef={cancelDelete} leadingIcon={<Trash2 size={24} />} className={`partner-delete-dialog${deletionUnresolved ? " partner-delete-dialog--locked" : ""}`} footer={<>
      <Button ref={cancelDelete} variant="tertiary" disabled={deletionUnresolved} onClick={() => changeDeleteOpen(false)}>Cancelar</Button>
      <Button variant="destructive" disabled={disabled || !canDelete} onClick={() => { void mutatePartner("delete", partner?.id); }}>Confirmar exclusão</Button>
    </>}>
      <p>A exclusão é permitida somente sem histórico de associação a ofertas.</p>
      {confirmDelete && <div ref={deletionFeedback} tabIndex={-1} className="partner-delete-feedback" aria-label="Resultado da exclusão"><PartnerMutationNotice /></div>}
    </Dialog>
  </section>;
}
