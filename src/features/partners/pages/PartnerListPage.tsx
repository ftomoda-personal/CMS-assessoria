import { useState, useSyncExternalStore } from "react";
import { Button, FilterGroup, Input, Pagination, Toast } from "@ftomoda/spectra-design-system";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "../../../components/PageHeader";
import { navigate } from "../../../app/routes";
import { offerRepository } from "../../offers/repository";
import { partnerRepository } from "../repository";
import { countPartnerOffers, derivePartners, filterPartners, listFilters, PAGE_SIZE, searchPartners } from "../list";
import type { PartnerFilter } from "../list";
import { PartnersTable } from "../components/PartnersTable";
import "../partners.css";
import type { PartnerNotice } from "./CreatePartnerPage";

export function PartnerListPage({ notice, onDismissNotice }: { notice: PartnerNotice | null; onDismissNotice: () => void }) {
  const { partners } = useSyncExternalStore(partnerRepository.subscribe, partnerRepository.getSnapshot);
  const { offers } = useSyncExternalStore(offerRepository.subscribe, offerRepository.getSnapshot);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PartnerFilter>("all");
  const [page, setPage] = useState(() => notice ? Math.floor(Math.max(0, partners.findIndex(partner => partner.id === notice.partnerId)) / PAGE_SIZE) + 1 : 1);
  const searched = searchPartners(derivePartners(partners, offers), query);
  const filtered = filterPartners(searched, filter);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(1, totalPages));
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  const options = listFilters.map(option => ({ ...option, count: filterPartners(searched, option.value).length }));
  const summary = `Mostrando ${filtered.length ? start + 1 : 0}-${start + visible.length} de ${filtered.length} parceiros`;

  return <div className="partner-list">
    {notice && <Toast key={notice.partnerId} className="creation-toast" variant={notice.variant} title={notice.title} description={notice.description} aria-live="polite" closeLabel="Fechar notificação" onDismiss={onDismissNotice} />}
    <PageHeader title="PARCEIROS" description="Gerencie os parceiros e suas ofertas" className="partner-list-header"
      actions={<Button leadingIcon={<Plus size={16} aria-hidden="true" />} onClick={() => navigate("/partners/new")}>Adicionar parceiro</Button>} />
    <div className="partner-search"><div className="partner-search-field"><Input size="md" showLabel={false} aria-label="Procure um parceiro" placeholder="Procure um parceiro" trailingIcon={<Search />} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></div></div>
    <div className="partner-filters"><FilterGroup aria-label="Filtrar parceiros por status" options={options} value={filter} onValueChange={value => {
      const option = listFilters.find(item => item.value === value);
      if (option) { setFilter(option.value); setPage(1); }
    }} /></div>
    <PartnersTable partners={visible} counts={countPartnerOffers(offers)} />
    <footer className="partner-list-footer">
      {totalPages > 0 ? <Pagination aria-label="Paginação dos parceiros" currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} summary={summary} previousLabel="Página anterior" nextLabel="Próxima página" getPageLabel={number => `Página ${number}`} /> : <span className="partner-empty-summary">{summary}</span>}
    </footer>
  </div>;
}
