import { CloudUpload } from "lucide-react";
import type { PersistedPartner } from "../mappers";

/** Static MVP presentation: no file input, drop handlers or upload lifecycle. */
export function PartnerLogoPlaceholder({ partner }: { partner?: PersistedPartner }) {
  return <section className="partner-logo-placeholder" aria-label="Logo do parceiro">
    <h2>Logo</h2>
    <div className="partner-logo-placeholder-content">
      {partner?.logoUrl ? <img className="logo-preview" src={partner.logoUrl} alt={`Logo atual de ${partner.name}`} /> : <CloudUpload size={48} aria-hidden="true" />}
      {partner && <p className="logo-filename">{partner.logoName ?? "Sem logo"}</p>}
      <strong>Em breve</strong>
      <p>O envio e a alteração de logos ainda não estão disponíveis.</p>
    </div>
  </section>;
}
