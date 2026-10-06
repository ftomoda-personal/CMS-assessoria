import type { Partner } from "./model";

export const mockPartners: readonly Partner[] = [
  { id: "nubank", name: "Nubank", website: "nubank.com.br", logoUrl: "/partners/nubank.png" },
  { id: "amazon", name: "Amazon", website: "amazon.com.br", logoUrl: "/partners/amazon.png" },
  { id: "ifood", name: "iFood", website: "ifood.com.br", logoUrl: "/partners/ifood.png" },
  { id: "shopee", name: "Shopee", website: "shopee.com", logoUrl: "/partners/shopee.png" },
  { id: "nike", name: "Nike", website: "nike.com.br" },
  // Explicitly synthetic session data makes filtered pagination testable.
  // Status is derived from Offer relationships, not fixture state.
  ...Array.from({ length: 23 }, (_, index): Partner => ({
    id: `example-partner-${index + 1}`,
    name: `Parceiro de exemplo ${String(index + 1).padStart(2, "0")}`,
    website: `parceiro${index + 1}.example`,
  })),
];
