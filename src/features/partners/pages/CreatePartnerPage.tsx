import { PartnerForm } from "../components/PartnerForm";
import type { PartnerNotice } from "../components/PartnerForm";
export type { PartnerNotice } from "../components/PartnerForm";

export function CreatePartnerPage({ onCreated }: { onCreated: (notice: PartnerNotice) => void }) {
  return <PartnerForm onSaved={onCreated} />;
}
