import type { Offer } from "../offers/model";
import type { Partner, PartnerStatus } from "./model";

export type ListedPartner = Partner & { readonly status: PartnerStatus };
export function derivePartners(partners: readonly Partner[], offers: readonly Offer[]): readonly ListedPartner[] {
  const counts = countPartnerOffers(offers);
  return partners.map(partner => ({ ...partner, status: (counts.get(partner.id)?.total ?? 0) > 0 ? "active" : "inactive" }));
}

export type PartnerFilter = "all" | PartnerStatus;
export const PAGE_SIZE = 5;
export const listFilters = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Ativos" },
  { value: "inactive", label: "Inativos" },
] as const;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
export function searchPartners<T extends Partner>(partners: readonly T[], query: string) {
  const term = normalize(query);
  return partners.filter(partner => normalize(`${partner.name} ${partner.website}`).includes(term));
}
export function filterPartners(partners: readonly ListedPartner[], filter: PartnerFilter) {
  return filter === "all" ? partners : partners.filter(partner => partner.status === filter);
}
export function countPartnerOffers(offers: readonly Offer[]) {
  const counts = new Map<string, { active: number; total: number }>();
  for (const offer of offers) {
    if (!offer.partnerId) continue;
    const count = counts.get(offer.partnerId) ?? { active: 0, total: 0 };
    count.total += 1;
    if (offer.status === "active") count.active += 1;
    counts.set(offer.partnerId, count);
  }
  return counts;
}
