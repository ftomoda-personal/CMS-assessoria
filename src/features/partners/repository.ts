import type { Partner } from "./model";
import { mockPartners } from "./mockData";

type Snapshot = { readonly partners: readonly Partner[] };
const listeners = new Set<() => void>();
const freezePartner = (partner: Partner): Partner => Object.freeze({ ...partner });
let snapshot: Snapshot = Object.freeze({ partners: Object.freeze(mockPartners.map(freezePartner)) });

/** Canonical partner source for this application session. No removal/cascade operation. */
export const partnerRepository = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getById(id: Partner["id"]) { return snapshot.partners.find(partner => partner.id === id); },
  /** Storage seam for session forms. Repository owns saved temporary URLs. */
  save(partner: Partner) {
    if (!partner.id || !partner.name.trim() || !partner.website.trim()) throw new Error("Incomplete partner");
    const exists = this.getById(partner.id);
    if (exists?.logoKind === "session-object-url" && exists.logoUrl && exists.logoUrl !== partner.logoUrl) URL.revokeObjectURL(exists.logoUrl);
    const partners = exists
      ? snapshot.partners.map(current => current.id === partner.id ? freezePartner(partner) : current)
      : [...snapshot.partners, freezePartner(partner)];
    snapshot = Object.freeze({ partners: Object.freeze(partners) });
    listeners.forEach(listener => listener());
  },
};

// Saved logos stay usable by Offers until this loaded application session ends.
window.addEventListener("pagehide", event => {
  if (event.persisted) return;
  for (const partner of snapshot.partners) {
    if (partner.logoKind === "session-object-url" && partner.logoUrl) URL.revokeObjectURL(partner.logoUrl);
  }
});
