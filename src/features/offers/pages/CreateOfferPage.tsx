import { OfferForm } from "../components/OfferForm";
import type { OfferNotice } from "../creation";

export function CreateOfferPage({ onCreated }: { onCreated: (notice: OfferNotice) => void }) {
  return <OfferForm onSaved={onCreated} />;
}
