import { useSyncExternalStore } from "react";
import { Button } from "@ftomoda/spectra-design-system";
import { OfferForm } from "../components/OfferForm";
import { offerRepository } from "../repository";
import type { OfferNotice } from "../creation";
import { PageHeader } from "../../../components/PageHeader";
import { navigate } from "../../../app/routes";

export function EditOfferPage({ offerId, onSaved }: { offerId: string; onSaved: (notice: OfferNotice) => void }) {
  const { offers } = useSyncExternalStore(offerRepository.subscribe, offerRepository.getSnapshot);
  const offer = offers.find(item => item.id === offerId);
  if (!offer) return <>
    <PageHeader title="EDITAR OFERTA" />
    <p role="status">Oferta não encontrada.</p>
    <Button onClick={() => navigate("/offers")}>Voltar para ofertas</Button>
  </>;
  return <OfferForm key={offer.id} offer={offer} onSaved={onSaved} />;
}
