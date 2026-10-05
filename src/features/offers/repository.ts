import { partnerRepository } from "../partners/repository";
import { mockOffers } from "./mockData";
import type { Offer, PartnerReference } from "./model";
import { activatedOffer } from "./activation";
import { calendarDate } from "./creation";

type Snapshot = { readonly offers: readonly Offer[]; readonly partners: readonly PartnerReference[] };
const listeners = new Set<() => void>();
const freezeOffer = (offer: Offer): Offer => Object.freeze({ ...offer });
let snapshot: Snapshot = Object.freeze({
  offers: Object.freeze(mockOffers.map(freezeOffer)),
  partners: partnerRepository.getSnapshot().partners,
});

// Keep the existing Offer snapshot contract backed by the canonical partner array.
partnerRepository.subscribe(() => {
  snapshot = Object.freeze({ ...snapshot, partners: partnerRepository.getSnapshot().partners });
  listeners.forEach(listener => listener());
});

/** Module lifetime = application session. No browser storage or automatic transitions. */
export const offerRepository = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getById(id: Offer["id"]) {
    return snapshot.offers.find(offer => offer.id === id);
  },
  update(offer: Offer) {
    const current = this.getById(offer.id);
    if (!current) throw new Error("Unknown offer");
    if (offer.partnerId !== current.partnerId) throw new Error("Partner cannot change");
    this.save(offer);
  },
  activate(id: Offer["id"]) {
    const current = this.getById(id);
    if (!current) throw new Error("Unknown offer");
    const offer = activatedOffer(current, calendarDate(new Date()));
    this.update(offer);
    return offer;
  },
  remove(id: Offer["id"]) {
    const current = this.getById(id);
    if (!current || current.status !== "inactive") throw new Error("Only inactive offers can be deleted");
    snapshot = Object.freeze({ ...snapshot, offers: Object.freeze(snapshot.offers.filter(offer => offer.id !== id)) });
    listeners.forEach(listener => listener());
  },
  /** Storage seam for later forms; IDs/statuses are provided by the caller. */
  save(offer: Offer) {
    if (offer.partnerId !== undefined && !snapshot.partners.some(partner => partner.id === offer.partnerId)) {
      throw new Error("Unknown partner reference");
    }
    const exists = snapshot.offers.some(current => current.id === offer.id);
    const next = exists
      ? snapshot.offers.map(current => current.id === offer.id ? freezeOffer(offer) : current)
      : [...snapshot.offers, freezeOffer(offer)];
    snapshot = Object.freeze({ ...snapshot, offers: Object.freeze(next) });
    listeners.forEach(listener => listener());
  },
};
