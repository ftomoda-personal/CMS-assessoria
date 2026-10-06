import { useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { Button, Dialog, Input, StatusBadge, Toast } from "@ftomoda/spectra-design-system";
import { Save, TriangleAlert, X } from "lucide-react";
import { PageHeader } from "../../../components/PageHeader";
import { navigate } from "../../../app/routes";
import { offerRepository } from "../../offers/repository";
import { partnerRepository } from "../repository";
import type { Partner } from "../model";
import { countPartnerOffers } from "../list";
import { LogoDropzone } from "./LogoDropzone";
import "../create-partner.css";

export type PartnerNotice = { partnerId: string; variant: "success"; title: string; description: string };
export function PartnerForm({ partner, onSaved }: { partner?: Partner; onSaved: (notice: PartnerNotice) => void }) {
  const editing = Boolean(partner);
  const [name, setName] = useState(partner?.name ?? "");
  const [website, setWebsite] = useState(partner?.website ?? "");
  const [logo, setLogo] = useState<File>();
  const [uploading, setUploading] = useState(false);
  const [operationError, setOperationError] = useState<"save" | "delete" | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const { offers } = useSyncExternalStore(offerRepository.subscribe, offerRepository.getSnapshot);
  const offerCount = partner ? countPartnerOffers(offers).get(partner.id)?.total ?? 0 : 0;
  const canDelete = partner ? partnerRepository.canDelete(partner.id) : false;
  const complete = Boolean(name.trim() && website.trim() && !uploading);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete) return;
    let temporaryUrl: string | undefined;
    let id: string;
    try {
      id = partner?.id ?? crypto.randomUUID();
      temporaryUrl = logo ? URL.createObjectURL(logo) : undefined;
      const next: Partner = {
        ...partner, id, name: name.trim(), website: website.trim(),
        logoUrl: temporaryUrl ?? partner?.logoUrl,
        logoKind: temporaryUrl ? "session-object-url" : partner?.logoKind,
        logoName: logo?.name ?? partner?.logoName,
      };
      if (partner) partnerRepository.update(next);
      else partnerRepository.save(next);
    } catch {
      if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
      setOperationError("save");
      return;
    }
    // Current Figma's edit-result title says "adicionado"; preserve its copy.
    onSaved({ partnerId: id, variant: "success", title: "Parceiro adicionado", description: `${name.trim()} foi ${editing ? "modificado" : "adicionado"} com sucesso.` });
  }
  function deletePartner() {
    if (!partner) return;
    try { partnerRepository.remove(partner.id); }
    catch { setDialogOpen(false); setOperationError("delete"); return; }
    setDialogOpen(false);
    onSaved({ partnerId: partner.id, variant: "success", title: "Parceiro excluído", description: `${partner.name} foi excluído com sucesso.` });
  }
  return <div className="create-partner">
    <PageHeader title={editing ? "EDITAR PARCEIRO" : "ADICIONAR PARCEIRO"} />
    {operationError && <Toast className="creation-toast" variant="error" title={operationError === "delete" ? "Não foi possível excluir o parceiro" : editing ? "Não foi possível modificar o parceiro" : "Não foi possível adicionar o parceiro"} description="Por favor tente novamente mais tarde." aria-live="assertive" closeLabel="Fechar notificação" onDismiss={() => setOperationError(null)} />}
    <form aria-label={editing ? "Editar parceiro" : "Criar parceiro"} onSubmit={submit}>
      <div className={editing ? "edit-partner-columns" : undefined}>
        <div className="create-partner-fields">
          <Input className={editing ? "edit-partner-input" : undefined} size={editing ? "lg" : "md"} label="Nome" name="name" required placeholder="ex: Nubank" value={name} onChange={event => setName(event.target.value)} />
          <Input className={editing ? "edit-partner-input" : undefined} size={editing ? "lg" : "md"} label="Link" name="website" required placeholder="ex: nubank.com.br" value={website} onChange={event => setWebsite(event.target.value)} />
          <LogoDropzone existingLogo={partner?.logoUrl ? { url: partner.logoUrl, name: partner.logoName ?? partner.logoUrl.split('/').pop() ?? "Logo atual", partnerName: partner.name } : undefined} onChange={(file, busy) => { setLogo(file); setUploading(busy); }} />
        </div>
        {editing && <aside className="edit-partner-options" aria-label="Relacionamentos do parceiro">
          <div className="edit-partner-panel">
            <div className="edit-partner-row"><span>Status:</span><StatusBadge variant={offerCount > 0 ? "success" : "error"}>{offerCount > 0 ? "Ativo" : "Inativo"}</StatusBadge></div>
            <div className="edit-partner-row"><span>Ofertas:</span><span>{offerCount}</span></div>
            <div className="edit-partner-delete">
              <p id="partner-delete-explanation">Parceiro só pode ser excluído se nunca foi associado a uma oferta.</p>
              <Button type="button" variant="destructive" size="sm" disabled={!canDelete} aria-describedby="partner-delete-explanation" onClick={() => setDialogOpen(true)}>Excluir parceiro</Button>
            </div>
          </div>
        </aside>}
      </div>
      <div className="create-partner-actions">
        <Button type="button" variant="tertiary" leadingIcon={<X size={16} aria-hidden="true" />} onClick={() => navigate("/partners")}>Cancelar</Button>
        <Button type="submit" disabled={!complete} leadingIcon={<Save size={16} aria-hidden="true" />}>Salvar</Button>
      </div>
    </form>
    {editing && <Dialog open={dialogOpen} onOpenChange={setDialogOpen} role="alertdialog" title="Excluir parceiro?" description="Esta ação não poderá ser desfeita." leadingIcon={<TriangleAlert size={24} aria-hidden="true" />} closeLabel="Fechar diálogo" initialFocusRef={cancelDeleteRef} footer={<>
      <Button ref={cancelDeleteRef} type="button" variant="tertiary" size="sm" onClick={() => setDialogOpen(false)}>Cancelar</Button>
      <Button type="button" variant="destructive" size="sm" onClick={deletePartner}>Excluir parceiro</Button>
    </>} />}
  </div>;
}
