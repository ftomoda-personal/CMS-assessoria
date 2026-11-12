import { IconButton, StatusBadge, Table, TableHeader, TableHeaderRow, TableHeaderCell, TableBody, TableRow, TableCell } from "@ftomoda/spectra-design-system";
import { Pencil } from "lucide-react";
import { navigate } from "../../../app/routes";
import type { ListedPartner } from "../list";
import type { countPartnerOffers } from "../list";

export function PartnersTable({ partners, counts }: { partners: readonly ListedPartner[]; counts: ReturnType<typeof countPartnerOffers> }) {
  return <Table className="partner-table" aria-label="Parceiros">
    <colgroup><col className="partner-col-name" /><col className="partner-desktop-only" /><col className="partner-col-count partner-wide-count" /><col className="partner-col-count partner-wide-count" /><col className="partner-col-status" /><col className="partner-col-actions" /></colgroup>
    <TableHeader><TableHeaderRow>
      <TableHeaderCell><span className="partner-wide-name">Nome</span><span className="partner-mobile-name">Parceiro</span></TableHeaderCell>
      <TableHeaderCell className="partner-desktop-only">Site</TableHeaderCell>
      <TableHeaderCell className="partner-wide-count">Ofertas ativas</TableHeaderCell>
      <TableHeaderCell className="partner-wide-count">Total de ofertas</TableHeaderCell>
      <TableHeaderCell>Status</TableHeaderCell>
      <TableHeaderCell>Ações</TableHeaderCell>
    </TableHeaderRow></TableHeader>
    <TableBody>
      {partners.map(partner => <TableRow key={partner.id}>
        <TableCell>{partner.name}<div className="partner-compact-counts"><span>Ofertas:</span><dl><div><dt>Totais</dt><dd>{counts.get(partner.id)?.total ?? 0}</dd></div><div><dt>Ativas</dt><dd>{counts.get(partner.id)?.active ?? 0}</dd></div></dl></div></TableCell>
        <TableCell className="partner-desktop-only">{partner.website}</TableCell>
        <TableCell className="partner-wide-count">{counts.get(partner.id)?.active ?? 0}</TableCell>
        <TableCell className="partner-wide-count">{counts.get(partner.id)?.total ?? 0}</TableCell>
        <TableCell><StatusBadge variant={partner.status === "active" ? "success" : "error"}>{partner.status === "active" ? "Ativo" : "Inativo"}</StatusBadge></TableCell>
        <TableCell><IconButton icon={Pencil} variant="tertiary" size="small" aria-label={`Editar parceiro: ${partner.name}`} onClick={() => navigate(`/partners/${encodeURIComponent(partner.id)}/edit`)} /></TableCell>
      </TableRow>)}
      {partners.length === 0 && <TableRow><TableCell colSpan={6}><span role="status">Nenhum parceiro encontrado.</span></TableCell></TableRow>}
    </TableBody>
  </Table>;
}
