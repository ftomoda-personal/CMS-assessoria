import { IconButton, StatusBadge, Table, TableHeader, TableHeaderRow, TableHeaderCell, TableBody, TableRow, TableCell } from "@ftomoda/spectra-design-system";
import { Pencil } from "lucide-react";
import { navigate } from "../../../app/routes";
import { formatDate, statusPresentation } from "../list";
import type { Offer, PartnerReference } from "../model";

export function OffersTable({ offers, partners }: { offers: readonly Offer[]; partners: readonly PartnerReference[] }) {
  const partnerById = new Map(partners.map(partner => [partner.id, partner]));
  return <Table aria-label="Ofertas dos parceiros" style={{ tableLayout: "fixed" }}>
    <colgroup><col /><col style={{ width: 700 }} /><col /><col /><col /><col /></colgroup>
    <TableHeader><TableHeaderRow>
      {["Parceiro", "Título da oferta", "Status", "Início", "Fim", "Ações"].map(title => <TableHeaderCell key={title}>{title}</TableHeaderCell>)}
    </TableHeaderRow></TableHeader>
    <TableBody>
      {offers.map(offer => {
        const partner = partnerById.get(offer.partnerId ?? "");
        const status = statusPresentation[offer.status];
        return <TableRow key={offer.id}>
          <TableCell>{partner ? <div className="offer-partner">{partner.logoUrl && <img src={partner.logoUrl} alt="" />}<span>{partner.name}</span></div> : "-"}</TableCell>
          <TableCell>{offer.title || "-"}</TableCell>
          <TableCell><StatusBadge variant={status.variant}>{status.label}</StatusBadge></TableCell>
          <TableCell>{formatDate(offer.startsOn)}</TableCell>
          <TableCell>{formatDate(offer.expiresOn)}</TableCell>
          <TableCell><div className="offer-row-actions"><IconButton icon={Pencil} variant="tertiary" size="small" aria-label={`Editar oferta: ${offer.title || "Sem título"}`} onClick={() => navigate(`/offers/${encodeURIComponent(offer.id)}/edit`)} /></div></TableCell>
        </TableRow>;
      })}
      {offers.length === 0 && <TableRow><TableCell colSpan={6}><span role="status">Nenhuma oferta encontrada.</span></TableCell></TableRow>}
    </TableBody>
  </Table>;
}
