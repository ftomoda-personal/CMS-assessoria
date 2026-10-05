import type { Offer, OfferStatus } from "./model";

const examples: readonly Offer[] = [
  { id: "offer-1", partnerId: "nubank", title: "Conta PJ sem tarifas", description: "Abra sua conta jurídica no Nubank sem mensalidade e sem burocracia. Gerencie tudo pelo app.", status: "active", startsOn: "2026-08-01", expiresOn: "2026-12-31" },
  { id: "offer-2", partnerId: "amazon", title: "Seja Prime - 30 dias grátis", description: "", status: "scheduled", startsOn: "2026-10-01", expiresOn: "2026-12-31" },
  { id: "offer-3", partnerId: "ifood", title: "Primeiro pedido com R$50,00 off".repeat(5), description: "", status: "draft" },
  { id: "offer-4", partnerId: "shopee", title: "Frete grátis na primeira compra", description: "", status: "expired", startsOn: "2026-01-01", expiresOn: "2026-07-30" },
];

// Synthetic records make pagination testable. Counts are coherent, not copied
// from Figma's inconsistent example counters. No status is inferred from dates.
const extraStatuses: readonly OfferStatus[] = [
  ...Array<OfferStatus>(9).fill("active"),
  ...Array<OfferStatus>(4).fill("scheduled"),
  ...Array<OfferStatus>(7).fill("draft"),
  ...Array<OfferStatus>(3).fill("expired"),
  "inactive",
];

export const mockOffers: readonly Offer[] = [
  ...examples,
  ...extraStatuses.map((status, index): Offer => {
    const example = examples[index % examples.length];
    return {
      id: `offer-${index + 5}`,
      partnerId: example.partnerId,
      title: `${example.title.replace(/(Primeiro pedido com R\$50,00 off)+/, "Primeiro pedido com R$50,00 off")} — exemplo ${index + 2}`,
      description: "",
      status,
      ...(status === "draft" ? {} : { startsOn: "2026-08-01", expiresOn: "2026-12-31" }),
    };
  }),
];
