import type { PersistedPartner } from "../features/partners/mappers";
import type { PersistedOffer } from "../features/offers/mappers";
import { ReadRepositoryError } from "../lib/supabase/readDataset.ts";
export type JointState = { status: "blocked" | "loading" | "ready" | "error" | "authorization"; refreshing?: boolean; refreshFailed?: boolean; partners: readonly PersistedPartner[]; offers: readonly PersistedOffer[] };
const empty = (status: JointState["status"]): JointState => ({ status, partners: [], offers: [] });
export function createJointLoader(reads: { partners(signal: AbortSignal): Promise<readonly PersistedPartner[]>; offers(signal: AbortSignal): Promise<readonly PersistedOffer[]> }) {
  let state = empty("blocked");
  let generation = 0;
  let controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  function publish(next: JointState) { state = next; listeners.forEach(listener => listener()); }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    clear() { generation++; controller?.abort(); publish(empty("blocked")); },
    async load(authorized: boolean, background = false) {
      const ticket = ++generation;
      controller?.abort();
      if (!authorized) { publish(empty("blocked")); return; }
      const current = new AbortController(); controller = current;
      const previous = state;
      const preserve = background && previous.status === "ready";
      publish(preserve ? { ...previous, refreshing: true, refreshFailed: false } : empty("loading"));
      try {
        const [partners, offers] = await Promise.all([reads.partners(current.signal), reads.offers(current.signal)]);
        if (ticket !== generation || current.signal.aborted) return;
        const ids = new Set(partners.map(partner => partner.id.toLowerCase()));
        if (offers.some(offer => offer.partnerId && !ids.has(offer.partnerId.toLowerCase()))) throw new ReadRepositoryError("incomplete");
        publish({ status: "ready", partners, offers });
      } catch (error) {
        if (ticket !== generation || current.signal.aborted) return;
        current.abort();
        const denied = error instanceof ReadRepositoryError && error.kind === "authorization";
        publish(denied ? empty("authorization") : preserve ? { ...previous, refreshing: false, refreshFailed: true } : empty("error"));
      }
    },
  };
}
