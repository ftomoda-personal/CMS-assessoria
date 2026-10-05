import type { Partner } from "./model";

export const mockPartners: readonly Partner[] = [
  { id: "nubank", name: "Nubank", website: "nubank.com.br", logoUrl: "/partners/nubank.png", status: "active" },
  { id: "amazon", name: "Amazon", website: "amazon.com.br", logoUrl: "/partners/amazon.png", status: "active" },
  { id: "ifood", name: "iFood", website: "ifood.com.br", logoUrl: "/partners/ifood.png", status: "active" },
  { id: "shopee", name: "Shopee", website: "shopee.com", logoUrl: "/partners/shopee.png", status: "active" },
  { id: "nike", name: "Nike", website: "nike.com.br", status: "inactive" },
  // Explicitly synthetic session data makes filtered pagination testable.
  // Status is fixture data, never inferred from offer counts.
  ...Array.from({ length: 23 }, (_, index): Partner => ({
    id: `example-partner-${index + 1}`,
    name: `Parceiro de exemplo ${String(index + 1).padStart(2, "0")}`,
    website: `parceiro${index + 1}.example`,
    status: index % 5 === 0 ? "inactive" : "active",
  })),
];
