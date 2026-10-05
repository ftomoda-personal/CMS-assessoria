import type { CalendarDate, Offer } from "./model";

/** Only these two explicit manual activation paths are supported. */
export function activatedOffer(offer: Offer, activatedOn: CalendarDate): Offer {
  if (offer.status !== "scheduled" && offer.status !== "inactive") {
    throw new Error("Offer cannot be manually activated from this status");
  }
  return {
    ...offer,
    status: "active",
    ...(offer.status === "scheduled" ? { publicationMode: "now", startsOn: activatedOn } : {}),
  };
}
