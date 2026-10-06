import { IconButton, StatusBadge, Table, TableHeader, TableHeaderRow, TableHeaderCell, TableBody, TableRow, TableCell } from "@ftomoda/spectra-design-system";
import { Pencil } from "lucide-react";
import { navigate } from "../../../app/routes";
import type { ListedPartner } from "../list";
import type { countPartnerOffers } from "../list";

export function PartnersTable({ partners, counts }: { partners: readonly ListedPartner[]; counts: ReturnType<typeof countPartnerOffers> }) {
  return <Table aria-label="Parceiros" style={{ tableLayout: "fixed" }}>
    <colgroup><col style={{ width: 160 }} /><col /><col style={{ width: 160 }} /><col style={{ width: 160 }} /><col style={{ width: 160 }} /><col style={{ width: 160 }} /></colgroup>
    <TableHeader><TableHeaderRow>
      {["Nome", "Site", "Ofertas ativas", "Total de ofertas", "Status", "Ações"].map(title => <TableHeaderCell key={title}>{title}</TableHeaderCell>)}
    </TableHeaderRow></TableHeader>
    <TableBody>
      {partners.map(partner => <TableRow key={partner.id}>
        <TableCell>{partner.name}</TableCell><TableCell>{partner.website}</TableCell>
        <TableCell>{counts.get(partner.id)?.active ?? 0}</TableCell>
        <TableCell>{counts.get(partner.id)?.total ?? 0}</TableCell>
        <TableCell><StatusBadge variant={partner.status === "active" ? "success" : "error"}>{partner.status === "active" ? "Ativo" : "Inativo"}</StatusBadge></TableCell>
        <TableCell><IconButton icon={Pencil} variant="tertiary" size="small" aria-label={`Editar parceiro: ${partner.name}`} onClick={() => navigate(`/partners/${encodeURIComponent(partner.id)}/edit`)} /></TableCell>
      </TableRow>)}
      {partners.length === 0 && <TableRow><TableCell colSpan={6}><span role="status">Nenhum parceiro encontrado.</span></TableCell></TableRow>}
    </TableBody>
  </Table>;
}
