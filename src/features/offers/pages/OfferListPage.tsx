import { useState, useSyncExternalStore } from "react";
import { Button, FilterGroup, Input, Pagination, Toast } from "@ftomoda/spectra-design-system";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "../../../components/PageHeader";
import { navigate } from "../../../app/routes";
import { offerRepository } from "../repository";
import { filterOffers, listFilters, PAGE_SIZE, searchOffers } from "../list";
import type { OfferFilter } from "../list";
import { OffersTable } from "../components/OffersTable";
import type { OfferNotice } from "../creation";
import "../offers.css";
import "../create-offer.css";

export function OfferListPage({ notice, onDismissNotice }: { notice: OfferNotice | null; onDismissNotice: () => void }) {
  const { offers, partners } = useSyncExternalStore(offerRepository.subscribe, offerRepository.getSnapshot);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<OfferFilter>("all");
  const [page, setPage] = useState(() => notice ? Math.floor(Math.max(0, offers.findIndex(offer => offer.id === notice.offerId)) / PAGE_SIZE) + 1 : 1);
  const searched = searchOffers(offers, partners, query);
  const filtered = filterOffers(searched, filter);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(1, totalPages));
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  const options = listFilters.map(option => ({ ...option, count: filterOffers(searched, option.value).length }));
  const summary = `Mostrando ${filtered.length ? start + 1 : 0}-${start + visible.length} de ${filtered.length} ofertas`;

  return <div className="offer-list" style={{ position: "relative" }}>
    {notice && <Toast key={notice.offerId} className="creation-toast" variant={notice.variant} title={notice.title} description={notice.description} aria-live="polite" closeLabel="Fechar notificação" onDismiss={onDismissNotice} />}
    <PageHeader title="OFERTAS" description="Gerencie as ofertas dos parceiros" className="offer-list-header"
      actions={<Button leadingIcon={<Plus size={16} aria-hidden="true" />} onClick={() => navigate("/offers/new")}>Criar oferta</Button>} />
    <div className="offer-search"><div className="offer-search-field"><Input size="md" showLabel={false} aria-label="Procure uma oferta" placeholder="Procure uma oferta" trailingIcon={<Search />} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></div></div>
    <div className="offer-filters"><FilterGroup aria-label="Filtrar ofertas por status" options={options} value={filter} onValueChange={value => {
      const option = listFilters.find(item => item.value === value);
      if (option) { setFilter(option.value); setPage(1); }
    }} /></div>
    <OffersTable offers={visible} partners={partners} />
    <footer className="offer-list-footer">
      {totalPages > 0 ? <Pagination aria-label="Paginação das ofertas" currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} summary={summary} previousLabel="Página anterior" nextLabel="Próxima página" getPageLabel={number => `Página ${number}`} /> : <span className="offer-empty-summary">{summary}</span>}
    </footer>
  </div>;
}
