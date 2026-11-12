import { useEffect, useId, useRef, useState } from "react";
import { Button, Checkbox, Dialog, Input, Radio, Select, StatusBadge, Textarea } from "@ftomoda/spectra-design-system";
import { Save, Send, Trash2, X } from "lucide-react";
import type { PersistedOffer, OfferSaveContent } from "../mappers";
import type { CalendarDate } from "../model";
import type { OfferNotice } from "../creation";
import { statusPresentation } from "../list";
import { CmsReadNotice } from "../../../app/CmsData";
import { useCmsData } from "../../../app/useCmsData";
import { navigate } from "../../../app/routes";
import { PageHeader } from "../../../components/PageHeader";
import { PartnerMutationNotice } from "../../partners/components/PartnerMutationNotice";
import "../create-offer.css";

/** Calendar validation only; status and business-date rules remain server-owned. */
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function OfferForm({ offer }: { offer?: PersistedOffer; onSaved: (notice: OfferNotice) => void }) {
  const { partners, offerCreateBlocked, status, refreshing, refreshFailed, mutationState, mutateOffer } = useCmsData();
  const [content, setContent] = useState<OfferSaveContent>(() => ({ partnerId: offer?.partnerId, title: offer?.title ?? "", subtitle: offer?.subtitle, description: offer?.description ?? "", publicationMode: offer?.publicationMode ?? "now", hasCoupon: offer?.hasCoupon ?? false, coupon: offer?.coupon, hasExpiration: offer?.hasExpiration ?? false, startsOn: offer?.startsOn, expiresOn: offer?.expiresOn }));
  const [invalid, setInvalid] = useState(false);
  const [dateErrors, setDateErrors] = useState<{ start?: string; expiration?: string }>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const deletionFeedback = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const requirementsId = useId();
  const publicationName = useId();
  const deleteRuleId = useId();
  const disabled = (!offer && offerCreateBlocked) || Boolean(refreshing || refreshFailed) || !["idle", "rejected", "confirmed"].includes(mutationState);
  const published = Boolean(offer?.publishedAt);
  const deletionUnresolved = ["pending", "uncertain", "refresh-failed"].includes(mutationState);
  const canDelete = Boolean(offer && offer.status !== "active");
  function changeDeleteOpen(open: boolean) {
    if (!open && deletionUnresolved) return;
    setConfirmDelete(open);
  }
  useEffect(() => {
    if (confirmDelete && deletionUnresolved) deletionFeedback.current?.focus({ preventScroll: true });
  }, [confirmDelete, deletionUnresolved]);
  function patch(value: Partial<OfferSaveContent>) { setContent(current => ({ ...current, ...value })); setInvalid(false); setDateErrors({}); }
  function save(publish: boolean) {
    if (disabled) return;
    const requiresComplete = publish || published;
    const start = published || content.publicationMode === "scheduled" ? content.startsOn : undefined;
    const expiration = content.hasExpiration ? content.expiresOn : undefined;
    const dates: { start?: string; expiration?: string } = {};
    if (start && !validDate(start)) dates.start = "Informe uma data de início válida.";
    if (expiration && !validDate(expiration)) dates.expiration = "Informe uma data de expiração válida.";
    if (!dates.start && !dates.expiration && start && expiration && expiration < start) dates.expiration = "A expiração não pode ser anterior ao início.";
    // A first scheduled publication must start today or later in São Paulo.
    // This is feedback only: the backend clock/constraints remain authoritative.
    if (publish && !published) {
      const parts = new Intl.DateTimeFormat("en", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      const today = ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
      if (content.publicationMode === "scheduled" && start && !dates.start && start < today) dates.start = "Escolha hoje ou uma data futura para agendar.";
      if (content.publicationMode === "now" && expiration && !dates.expiration && expiration < today) dates.expiration = "A expiração não pode ser anterior ao início da publicação de hoje.";
    }
    setDateErrors(dates);
    const missing = requiresComplete && (!content.partnerId || !content.title.trim() || !content.description.trim() || (content.hasCoupon && !content.coupon?.trim()) || (content.publicationMode === "scheduled" && !content.startsOn) || (content.hasExpiration && !content.expiresOn));
    setInvalid(Boolean(missing));
    if (missing || dates.start || dates.expiration) return;
    void mutateOffer({ kind: "save", id: offer?.id ?? null, publish, content: { ...content, title: content.title.trim(), description: content.description.trim(), coupon: content.hasCoupon ? content.coupon : undefined, expiresOn: content.hasExpiration ? content.expiresOn : undefined, startsOn: published || content.publicationMode === "scheduled" ? content.startsOn : undefined } });
  }
  useEffect(() => {
    if (invalid || dateErrors.start || dateErrors.expiration) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [invalid, dateErrors]);
  const missingPartner = invalid && !content.partnerId;
  const missingTitle = invalid && !content.title.trim();
  const missingDescription = invalid && !content.description.trim();
  const missingCoupon = invalid && content.hasCoupon && !content.coupon?.trim();
  const missingStart = invalid && content.publicationMode === "scheduled" && !content.startsOn;
  const missingExpiration = invalid && content.hasExpiration && !content.expiresOn;
  if (status !== "ready") return <CmsReadNotice />;
  return <section className={`offer-form${offer ? " offer-form--edit" : " offer-form--create"}`}>
    <PageHeader title={offer ? "EDITAR OFERTA" : "NOVA OFERTA"} description={offer ? "Modifique os dados da oferta" : "Crie ofertas para os parceiros"} />
    <p id={requirementsId} className="offer-form-help">Campos com * são obrigatórios para publicar. Rascunhos podem ficar incompletos.</p>
    {invalid && <p role="alert" className="offer-form-error">Preencha parceiro, título, descrição e os campos opcionais ativados. Ofertas publicadas devem permanecer completas.</p>}
    {(dateErrors.start || dateErrors.expiration) && <p role="alert" className="offer-form-error">{dateErrors.start} {dateErrors.expiration}</p>}
    <form ref={formRef} noValidate aria-label={offer ? "Editar oferta" : "Criar oferta"} aria-describedby={requirementsId} aria-busy={mutationState === "pending"}
      onSubmit={event => { event.preventDefault(); save(false); }}>
      <fieldset className="offer-form-fieldset" disabled={disabled}>
        <legend className="offer-form-sr-only">Dados da oferta</legend>
        <div className={`offer-form-grid${offer ? " offer-form-grid--edit" : ""}`}>
          {offer && <section className="offer-form-panel offer-form-status" aria-label="Situação da oferta">
            <div className="offer-form-status-row"><span>Status:</span><StatusBadge variant={statusPresentation[offer.status].variant}>{statusPresentation[offer.status].label}</StatusBadge></div>
            <p>Habilitada: {offer.enabled ? "Sim" : "Não"}</p>
            <div className="offer-form-status-actions">
              {published && <Button type="button" variant="tertiary" size="sm" disabled={disabled} onClick={() => { void mutateOffer({ kind: "enabled", id: offer.id, enabled: !offer.enabled }); }}>{offer.enabled ? "Desabilitar" : "Habilitar"}</Button>}
              {offer.status === "scheduled" && <Button type="button" variant="tertiary" size="sm" disabled={disabled} onClick={() => { void mutateOffer({ kind: "activate", id: offer.id }); }}>Ativar agora</Button>}
            </div>
            <p>Habilitar preserva as datas; uma oferta expirada pode continuar expirada.</p>
            <p id={deleteRuleId}>{offer.status === "active" ? "Desabilite a oferta e, depois, confirme a exclusão." : "A exclusão preserva o histórico de associação do parceiro."}</p>
            <Button type="button" variant="destructive" size="sm" aria-describedby={deleteRuleId} disabled={disabled || !canDelete} onClick={() => setConfirmDelete(true)}>Excluir oferta</Button>
          </section>}
          <div className="offer-form-fields">
            <Select label="Parceiro" name="partnerId" value={content.partnerId ?? ""} disabled={disabled || published}
              options={[{ value: "", label: "Sem parceiro" }, ...partners.map(partner => ({ value: partner.id, label: partner.name }))]}
              validationState={missingPartner ? "error" : "default"} helperText={missingPartner ? "Escolha um parceiro para publicar." : published ? "Parceiro vinculado à publicação; associação bloqueada." : "Obrigatório para publicar; opcional no rascunho."}
              onValueChange={value => patch({ partnerId: value || undefined })} />
            <Input className="offer-publish-required" label="Título" aria-label="Título" name="title" aria-required={published || invalid} aria-describedby={requirementsId} placeholder="ex: 10% de desconto na primeira compra"
              value={content.title} disabled={disabled} state={missingTitle ? "error" : "default"} supportingText="Informe o título para publicar." showSupportingText={missingTitle}
              onChange={event => patch({ title: event.target.value })} />
            <Input label="Subtítulo" name="subtitle" placeholder="ex: Cadastre-se e aproveite o desconto" value={content.subtitle ?? ""} disabled={disabled} onChange={event => patch({ subtitle: event.target.value })} />
            <Textarea className="offer-publish-required" label="Descrição" aria-label="Descrição" name="description" aria-required={published || invalid} aria-describedby={requirementsId} rows={4}
              placeholder="ex: Ganhe 10% de desconto na primeira compra, após realizar cadastro. Válido apenas para novos cadastros."
              value={content.description} disabled={disabled} validationState={missingDescription ? "error" : "default"} supportingText="Informe a descrição para publicar." showSupportingText={missingDescription}
              onChange={event => patch({ description: event.target.value })} />
            <div className="offer-form-coupon">
              <Checkbox label="Esta oferta possui um cupom" checked={content.hasCoupon} disabled={disabled} onChange={event => patch({ hasCoupon: event.target.checked })} />
              {content.hasCoupon && <Input className="offer-publish-required" label="Cupom" aria-label="Cupom" name="coupon" aria-required={published || invalid} aria-describedby={requirementsId}
                value={content.coupon ?? ""} disabled={disabled} state={missingCoupon ? "error" : "default"} supportingText="Informe o cupom para publicar." showSupportingText={missingCoupon}
                onChange={event => patch({ coupon: event.target.value })} />}
            </div>
          </div>
          <section className="offer-form-panel offer-form-publication" aria-label="Publicação">
            <div role="radiogroup" aria-label="Modo de publicação" className="offer-form-publication-options">
              <Radio name={publicationName} label="Publicar agora" supportingText="A oferta ficará disponível imediatamente" showSupportingText checked={content.publicationMode === "now"} disabled={disabled || published} onChange={() => patch({ publicationMode: "now" })} />
              <Radio name={publicationName} label="Agendar publicação" supportingText="Escolha a data de início da oferta" showSupportingText checked={content.publicationMode === "scheduled"} disabled={disabled || published} onChange={() => patch({ publicationMode: "scheduled" })} />
            </div>
            {(published || content.publicationMode === "scheduled") && <Input type="date" label="Início" name="startsOn" value={content.startsOn ?? ""} disabled={disabled || published}
              aria-invalid={missingStart || Boolean(dateErrors.start)} state={missingStart || dateErrors.start ? "error" : "default"} supportingText={dateErrors.start ?? "Informe o início para agendar a publicação."} showSupportingText={missingStart || Boolean(dateErrors.start)}
              onChange={event => patch({ startsOn: (event.target.value || undefined) as CalendarDate | undefined })} />}
          </section>
          <section className="offer-form-panel offer-form-expiration" aria-label="Expiração">
            <Checkbox label="Data de expiração" supportingText="Ative esta opção se a oferta tem data de expiração" showSupportingText checked={content.hasExpiration} disabled={disabled} onChange={event => patch({ hasExpiration: event.target.checked })} />
            {content.hasExpiration && <Input type="date" label="Expiração" name="expiresOn" value={content.expiresOn ?? ""} disabled={disabled}
              aria-invalid={missingExpiration || Boolean(dateErrors.expiration)} state={missingExpiration || dateErrors.expiration ? "error" : "default"} supportingText={dateErrors.expiration ?? "Informe a data de expiração para publicar."} showSupportingText={missingExpiration || Boolean(dateErrors.expiration)}
              onChange={event => patch({ expiresOn: (event.target.value || undefined) as CalendarDate | undefined })} />}
          </section>
        </div>
        <p className="offer-form-help">Datas consideradas no horário de São Paulo.</p>
        <div className="offer-form-actions">
          <Button type="button" variant="tertiary" leadingIcon={<X size={16} aria-hidden="true" />} disabled={disabled} onClick={() => navigate("/offers")}>Cancelar</Button>
          <div className="offer-form-save-actions">
            <Button type="submit" variant={published ? "primary" : "secondary"} leadingIcon={<Save size={16} aria-hidden="true" />} disabled={disabled}>{published ? "Salvar alterações" : "Salvar rascunho"}</Button>
            {!published && <Button type="button" leadingIcon={<Send size={16} aria-hidden="true" />} disabled={disabled} onClick={() => save(true)}>{content.publicationMode === "scheduled" ? "Agendar publicação" : "Publicar agora"}</Button>}
          </div>
        </div>
      </fieldset>
    </form>
    <Dialog open={confirmDelete} onOpenChange={changeDeleteOpen} title="Excluir oferta?" description={`Excluir a oferta “${offer?.title || "Sem título"}”? Esta ação não pode ser desfeita pelo CMS.`} role="alertdialog" closeLabel="Fechar confirmação de exclusão" initialFocusRef={cancelDelete} leadingIcon={<Trash2 size={24} aria-hidden="true" />} footer={<>
      <Button ref={cancelDelete} type="button" variant="tertiary" disabled={deletionUnresolved} onClick={() => changeDeleteOpen(false)}>Cancelar</Button>
      <Button type="button" variant="destructive" disabled={disabled || !canDelete} onClick={() => { if (offer) void mutateOffer({ kind: "delete", id: offer.id }); }}>Confirmar exclusão</Button>
    </>}>
      <p>Ofertas ativas precisam ser desabilitadas antes de excluir. O histórico do parceiro será preservado.</p>
      {confirmDelete && <div ref={deletionFeedback} tabIndex={-1} aria-label="Resultado da exclusão"><PartnerMutationNotice /></div>}
    </Dialog>
  </section>;
}
