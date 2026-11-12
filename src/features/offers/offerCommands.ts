import { MutationError, parsePersistedUuid } from "../../lib/supabase/mutation.ts";
import type { MutationOptions } from "../../lib/supabase/mutation";
import type { PersistedOffer, OfferSaveContent } from "./mappers";
import type { PersistedPartner } from "../partners/mappers";
import type { createOffersWriteRepository } from "./supabaseWriteRepository";
export type OfferCommand = { kind: "save"; id: string | null; content: OfferSaveContent; publish: boolean } | { kind: "enabled"; id: string; enabled: boolean } | { kind: "activate"; id: string } | { kind: "delete"; id: string };
export function dispatchOfferCommand(repository: ReturnType<typeof createOffersWriteRepository>, command: OfferCommand, data: { partners: readonly PersistedPartner[]; offers: readonly PersistedOffer[] }, options: MutationOptions) {
 const target = command.id === null ? undefined : data.offers.find(offer => offer.id === command.id);
 if (command.id !== null && !target) throw new MutationError("missing");
 if (command.id !== null) parsePersistedUuid(command.id);
 if (command.kind === "save") {
  const partnerId = command.content.partnerId;
  if (partnerId) {
   parsePersistedUuid(partnerId);
   if (!data.partners.some(partner => partner.id === partnerId)) throw new MutationError("domain");
  }
  if (command.publish && !partnerId) throw new MutationError("domain");
  if (target?.publishedAt && partnerId !== target.partnerId) throw new MutationError("domain");
  return repository.save(command.content, { id: command.id, publish: command.publish }, options);
 }
 if (command.kind === "delete") {
  if (!target || target.status === "active") throw new MutationError("domain");
  return repository.softDelete(command.id, options);
 }
 if (!target?.publishedAt) throw new MutationError("domain");
 if (command.kind === "activate") {
  if (target.status !== "scheduled") throw new MutationError("domain");
  return repository.activateScheduled(command.id, options);
 }
 return repository.setEnabled(command.id, command.enabled, options);
}
