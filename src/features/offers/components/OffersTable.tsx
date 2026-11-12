import { IconButton, StatusBadge, Table, TableHeader, TableHeaderRow, TableHeaderCell, TableBody, TableRow, TableCell } from "@ftomoda/spectra-design-system";
import { Pencil } from "lucide-react";
import { navigate } from "../../../app/routes";
import { formatDate, statusPresentation } from "../list";
import type { Offer, PartnerReference } from "../model";

export function OffersTable({ offers, partners }: { offers: readonly Offer[]; partners: readonly PartnerReference[] }) {
  const partnerById = new Map(partners.map(partner => [partner.id, partner]));
  return <Table className="offer-table" aria-label="Ofertas dos parceiros">
    <colgroup><col className="offer-col-partner" /><col className="offer-col-title offer-desktop-only" /><col className="offer-col-status" /><col className="offer-col-date offer-date" /><col className="offer-col-date offer-date" /><col className="offer-col-actions" /></colgroup>
    <TableHeader><TableHeaderRow>
      <TableHeaderCell>Parceiro</TableHeaderCell>
      <TableHeaderCell className="offer-desktop-only">Título da oferta</TableHeaderCell>
      <TableHeaderCell>Status</TableHeaderCell>
      <TableHeaderCell className="offer-date">Início</TableHeaderCell>
      <TableHeaderCell className="offer-date">Fim</TableHeaderCell>
      <TableHeaderCell>Ações</TableHeaderCell>
    </TableHeaderRow></TableHeader>
    <TableBody>
      {offers.map(offer => {
        const partner = partnerById.get(offer.partnerId ?? "");
        const status = statusPresentation[offer.status];
        return <TableRow key={offer.id}>
          <TableCell><div className="offer-partner">{partner?.logoUrl && <img src={partner.logoUrl} alt="" />}<div className="offer-partner-text"><span>{partner?.name ?? "-"}</span><span className="offer-compact-title" title={offer.title || undefined}>{offer.title || "-"}</span></div></div></TableCell>
          <TableCell className="offer-desktop-only">{offer.title || "-"}</TableCell>
          <TableCell><StatusBadge variant={status.variant}>{status.label}</StatusBadge></TableCell>
          <TableCell className="offer-date">{formatDate(offer.startsOn)}</TableCell>
          <TableCell className="offer-date">{formatDate(offer.expiresOn)}</TableCell>
          <TableCell><div className="offer-row-actions"><IconButton icon={Pencil} variant="tertiary" size="small" aria-label={`Editar oferta: ${offer.title || "Sem título"}`} onClick={() => navigate(`/offers/${encodeURIComponent(offer.id)}/edit`)} /></div></TableCell>
        </TableRow>;
      })}
      {offers.length === 0 && <TableRow><TableCell colSpan={6}><span role="status">Nenhuma oferta encontrada.</span></TableCell></TableRow>}
    </TableBody>
  </Table>;
}
