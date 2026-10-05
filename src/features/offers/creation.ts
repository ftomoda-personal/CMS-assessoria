import type { CalendarDate, Offer } from "./model";

export type OfferNotice = { offerId: string; variant: "success" | "warning"; title: string; description: string };
export type PublicationMode = "now" | "scheduled";

/** Convert a local calendar selection without UTC conversion. */
export function calendarDate(date: Date): CalendarDate {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` as CalendarDate;
}

export function creationNotice(offer: Offer, partnerName?: string): OfferNotice {
  return offer.status === "draft"
    ? { offerId: offer.id, variant: "warning", title: "Oferta salva como rascunho", description: "Preencha todos os campos obrigatórios para publica-la" }
    : { offerId: offer.id, variant: "success", title: "Oferta adicionada", description: `Oferta do ${partnerName} adicionada com sucesso` };
}
