import type { Offer } from "../offers/model";
import type { Partner, PartnerStatus } from "./model";

export type PartnerFilter = "all" | PartnerStatus;
export const PAGE_SIZE = 5;
export const listFilters = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Ativos" },
  { value: "inactive", label: "Inativos" },
] as const;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
export function searchPartners(partners: readonly Partner[], query: string) {
  const term = normalize(query);
  return partners.filter(partner => normalize(`${partner.name} ${partner.website}`).includes(term));
}
export function filterPartners(partners: readonly Partner[], filter: PartnerFilter) {
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
