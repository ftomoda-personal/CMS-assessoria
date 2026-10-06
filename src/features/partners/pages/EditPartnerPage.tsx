import { useSyncExternalStore } from "react";
import { Button } from "@ftomoda/spectra-design-system";
import { PageHeader } from "../../../components/PageHeader";
import { navigate } from "../../../app/routes";
import { partnerRepository } from "../repository";
import { PartnerForm } from "../components/PartnerForm";
import type { PartnerNotice } from "../components/PartnerForm";

export function EditPartnerPage({ partnerId, onSaved }: { partnerId: string; onSaved: (notice: PartnerNotice) => void }) {
  const { partners } = useSyncExternalStore(partnerRepository.subscribe, partnerRepository.getSnapshot);
  const partner = partners.find(current => current.id === partnerId);
  if (!partner) return <>
    <PageHeader title="EDITAR PARCEIRO" />
    <p role="status">Parceiro não encontrado.</p>
    <Button onClick={() => navigate("/partners")}>Voltar para parceiros</Button>
  </>;
  return <PartnerForm key={partner.id} partner={partner} onSaved={onSaved} />;
}
