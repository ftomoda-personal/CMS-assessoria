import type { StatusBadgeVariant } from "@ftomoda/spectra-design-system";
import type { CalendarDate, Offer, OfferStatus, PartnerReference } from "./model";

export const statusPresentation: Record<OfferStatus, { label: string; variant: StatusBadgeVariant }> = {
  active: { label: "Ativo", variant: "success" },
  scheduled: { label: "Agendado", variant: "info" },
  draft: { label: "Rascunho", variant: "warning" },
  expired: { label: "Expirado", variant: "error" },
  inactive: { label: "Inativo", variant: "error" },
};

// The current list has five filters. Inactive appears under Todos only.
export const listFilters = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Ativos" },
  { value: "scheduled", label: "Agendados" },
  { value: "draft", label: "Rascunhos" },
  { value: "expired", label: "Expirados" },
] as const;
export type OfferFilter = typeof listFilters[number]["value"];
export const PAGE_SIZE = 4; // Matches the currently designed first page; provisional.

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

export function searchOffers(offers: readonly Offer[], partners: readonly PartnerReference[], query: string) {
  const term = normalize(query);
  const partnerNames = new Map(partners.map(partner => [partner.id, partner.name]));
  return offers.filter(offer => normalize(`${offer.title} ${partnerNames.get(offer.partnerId ?? "") ?? ""}`).includes(term));
}

export function filterOffers(offers: readonly Offer[], filter: OfferFilter) {
  return offers.filter(offer => filter === "all" || offer.status === filter);
}

export function formatDate(date?: CalendarDate) {
  if (!date) return "-";
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}
