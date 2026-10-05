import { useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { Button, Checkbox, DatePicker, Input, Radio, Select, Textarea, Toast, Dialog, StatusBadge } from "@ftomoda/spectra-design-system";
import { Save, X, TriangleAlert } from "lucide-react";
import { PageHeader } from "../../../components/PageHeader";
import { navigate } from "../../../app/routes";
import { offerRepository } from "../repository";
import { calendarDate, creationNotice } from "../creation";
import type { OfferNotice, PublicationMode } from "../creation";
import type { Offer } from "../model";
import { statusPresentation } from "../list";
import { dateSelection, publicationComplete } from "../form";
import "../create-offer.css";

const dateMessages = { chooseDate: "Escolher data", previousMonth: "Mês anterior", nextMonth: "Próximo mês" };

export function OfferForm({ offer: initialOffer, onSaved }: { offer?: Offer; onSaved: (notice: OfferNotice) => void }) {
  const editing = Boolean(initialOffer);
  const [status, setStatus] = useState(initialOffer?.status);
  const [dialogOpen, setDialogOpen] = useState(false);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const [statusNotice, setStatusNotice] = useState<OfferNotice | null>(null);
  const { partners } = useSyncExternalStore(offerRepository.subscribe, offerRepository.getSnapshot);
  const [partnerId, setPartnerId] = useState(initialOffer?.partnerId ?? "");
  const [title, setTitle] = useState(initialOffer?.title ?? "");
  const [subtitle, setSubtitle] = useState(initialOffer?.subtitle ?? "");
  const [description, setDescription] = useState(initialOffer?.description ?? "");
  const [hasCoupon, setHasCoupon] = useState(initialOffer?.hasCoupon ?? Boolean(initialOffer?.coupon));
  const [coupon, setCoupon] = useState(initialOffer?.coupon ?? "");
  const [publicationMode, setPublicationMode] = useState<PublicationMode>(initialOffer?.publicationMode ?? (initialOffer?.status === "scheduled" ? "scheduled" : "now"));
  const [startsOn, setStartsOn] = useState<Date | null>(dateSelection(initialOffer?.startsOn));
  const [hasExpiration, setHasExpiration] = useState(initialOffer?.hasExpiration ?? Boolean(initialOffer?.expiresOn));
  const [expiresOn, setExpiresOn] = useState<Date | null>(dateSelection(initialOffer?.expiresOn));
  const [saveError, setSaveError] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const complete = publicationComplete({ partnerId, title, description, hasCoupon, coupon, publicationMode, startsOn, hasExpiration, expiresOn });
    const offer: Offer = {
      id: initialOffer?.id ?? crypto.randomUUID(), partnerId: initialOffer ? initialOffer.partnerId : partnerId || undefined,
      title: title.trim(), subtitle: subtitle.trim() || undefined, description: description.trim(),
      publicationMode, hasCoupon, hasExpiration,
      coupon: hasCoupon ? coupon.trim() : undefined,
      startsOn: initialOffer && initialOffer.status !== "draft" ? initialOffer.startsOn : publicationMode === "now" ? (complete ? calendarDate(new Date()) : undefined) : (startsOn ? calendarDate(startsOn) : undefined),
      expiresOn: hasExpiration && expiresOn ? calendarDate(expiresOn) : undefined,
      status: initialOffer && initialOffer.status !== "draft" ? status! : complete ? (publicationMode === "now" ? "active" : "scheduled") : "draft",
    };
    try {
      if (initialOffer) offerRepository.update(offer);
      else offerRepository.save(offer);
    } catch {
      setSaveError(true);
      return;
    }
    onSaved(initialOffer ? { offerId: offer.id, variant: "success", title: "Oferta modificada", description: partnerName ? `Oferta do ${partnerName} foi modificada com sucesso` : "Oferta foi modificada com sucesso" } : creationNotice(offer, partnerName));
  }

  const partnerName = partners.find(partner => partner.id === partnerId)?.name;
  function changeStatus() {
    if (!initialOffer || (status !== "active" && status !== "inactive" && status !== "scheduled")) return;
    const nextStatus = status === "active" ? "inactive" : "active";
    const stored = offerRepository.getById(initialOffer.id);
    if (!stored) return;
    if (nextStatus === "active") offerRepository.activate(stored.id);
    else offerRepository.update({ ...stored, status: nextStatus });
    if (status === "scheduled") {
      onSaved({ offerId: initialOffer.id, variant: "success", title: "Oferta ativada", description: "A oferta já está disponível para os usuários." });
      return;
    }
    if (nextStatus === "inactive") {
      onSaved({ offerId: initialOffer.id, variant: "warning", title: "Oferta desativada", description: "A oferta não está mais disponível para os usuários." });
      return;
    }
    setStatus(nextStatus);
    setStatusNotice({ offerId: initialOffer.id, variant: "success", title: "Oferta reativada", description: `Oferta do ${partnerName} foi reativada com sucesso` });
  }
  function deleteOffer() {
    if (!initialOffer || status !== "inactive") return;
    offerRepository.remove(initialOffer.id);
    setDialogOpen(false);
    onSaved({ offerId: initialOffer.id, variant: "success", title: "Oferta excluida", description: `Oferta do ${partnerName} foi excluída com sucesso` });
  }

  return <div className="create-offer">
    <PageHeader title={editing ? "EDITAR OFERTA" : "NOVA OFERTA"} description={editing ? "Modifique e exclua as ofertas" : undefined} className={editing ? "edit-offer-header" : "create-offer-header"} />
    {statusNotice && <Toast className="creation-toast" variant={statusNotice.variant} title={statusNotice.title} description={statusNotice.description} closeLabel="Fechar notificação" onDismiss={() => setStatusNotice(null)} />}
    {saveError && <Toast className="creation-toast" variant="error" title={editing ? "Não foi possível modificar a oferta" : "Não foi possível adicionar a oferta"} description="Por favor tente novamente mais tarde" closeLabel="Fechar notificação" onDismiss={() => setSaveError(false)} />}
    <form noValidate onSubmit={submit} aria-label={editing ? "Editar oferta" : "Criar oferta"}>
      <div className="create-offer-columns">
        <div className="create-offer-fields">
          {editing ? <Input className="create-offer-input" label="Parceiro" disabled value={partnerName ?? "-"} /> : <Select className="create-offer-partner" name="partnerId" label="Parceiro" required placeholder="Escolha uma opção" options={partners.map(partner => ({ value: partner.id, label: partner.name }))} value={partnerId} onValueChange={setPartnerId} />}
          <Input className="create-offer-input" name="title" label="Título" required placeholder="ex: 10% de desconto na primeira compra" value={title} onChange={event => setTitle(event.target.value)} />
          <Input className="create-offer-input" name="subtitle" label="Subtítulo" placeholder="ex: Cadastre-se e aproveite o desconto" value={subtitle} onChange={event => setSubtitle(event.target.value)} />
          <Textarea name="description" label="Descriçao" required placeholder="ex: Ganhe 10% de desconto na primeira compra, após realizar cadastro. Válido apenas para novos cadastros." value={description} onChange={event => setDescription(event.target.value)} />
          <div className={hasCoupon ? "create-offer-coupon create-offer-coupon--expanded" : "create-offer-coupon"}>
            <Checkbox label="Esta oferta possui um cupom" checked={hasCoupon} onChange={event => setHasCoupon(event.target.checked)} />
            {hasCoupon && <Input className="create-offer-input" name="coupon" label="Cupom" required placeholder="ex: OFERTA10" value={coupon} onChange={event => setCoupon(event.target.value)} />}
          </div>
        </div>
        <div className="create-offer-options">
          {editing ? <div className="create-offer-panel edit-offer-status">
            <div className="create-offer-conditional">
              <div className="edit-offer-status-row"><span>Status:</span><StatusBadge variant={statusPresentation[status!].variant}>{statusPresentation[status!].label}</StatusBadge></div>
              {(status === "active" || status === "inactive" || status === "scheduled") && <Button type="button" variant="tertiary" size="sm" onClick={changeStatus}>{status === "active" ? "Desativar oferta" : status === "scheduled" ? "Ativar oferta" : "Reativar oferta"}</Button>}
            </div>
            <div className="create-offer-conditional">
              {status === "active" && <p id="delete-explanation">Para excluir esta oferta, desative-a primeiro.Ofertas ativas não podem ser excluídas.</p>}
              {status === "inactive" && <p id="delete-explanation">A exclusão da oferta é permanente e não pode ser desfeita</p>}
              {(status === "active" || status === "inactive") && <Button type="button" variant="destructive" size="sm" disabled={status === "active"} aria-describedby="delete-explanation" onClick={() => setDialogOpen(true)}>Excluir oferta</Button>}
            </div>
          </div> : <fieldset className="create-offer-panel" aria-label="Publicação">
            <Radio name="publicationMode" value="now" label="Publicar agora" supportingText="A oferta ficará disponível imediatamente" showSupportingText checked={publicationMode === "now"} onChange={() => setPublicationMode("now")} />
            <div className="create-offer-conditional">
              <Radio name="publicationMode" value="scheduled" label="Agendar publicação" supportingText="Escolha a data de início da oferta" showSupportingText checked={publicationMode === "scheduled"} onChange={() => setPublicationMode("scheduled")} />
              {publicationMode === "scheduled" && <DatePicker style={{ width: "min(320px, 100%)" }} label="Data" aria-label="Data de publicação" aria-required="true" placeholder="DD/MM/AAAA" locale="pt-BR" messages={dateMessages} value={startsOn} onChange={setStartsOn} />}
            </div>
          </fieldset>}
          <div className="create-offer-panel create-offer-conditional">
            <Checkbox label="Data de expiração" supportingText={editing ? "Defina quando esta oferta deve expirar" : "Ative esta opção se a oferta tem data de expiração"} showSupportingText checked={hasExpiration} onChange={event => setHasExpiration(event.target.checked)} />
            {hasExpiration && <DatePicker style={{ width: "min(320px, 100%)" }} label="Data" aria-label="Data de expiração" aria-required="true" placeholder="DD/MM/AAAA" locale="pt-BR" messages={dateMessages} value={expiresOn} onChange={setExpiresOn} />}
          </div>
        </div>
      </div>
      <div className="create-offer-actions">
        <Button type="button" variant="tertiary" leadingIcon={<X size={16} aria-hidden="true" />} onClick={() => navigate("/offers")}>Cancelar</Button>
        <Button type="submit" leadingIcon={<Save size={16} aria-hidden="true" />}>Salvar</Button>
      </div>
    </form>
    {editing && <Dialog open={dialogOpen} onOpenChange={setDialogOpen} role="alertdialog" title="Excluir oferta?" description="Esta ação não poderá ser desfeita." leadingIcon={<TriangleAlert size={24} aria-hidden="true" />} closeLabel="Fechar diálogo" initialFocusRef={cancelDeleteRef} footer={<>
      <Button ref={cancelDeleteRef} type="button" variant="tertiary" size="sm" onClick={() => setDialogOpen(false)}>Cancelar</Button>
      <Button type="button" variant="destructive" size="sm" onClick={deleteOffer}>Excluir oferta</Button>
    </>} /> }
  </div>;
}
