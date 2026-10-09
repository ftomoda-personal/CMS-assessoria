import type { OfferReadRow, OfferRpcContracts, OfferRow } from "../../lib/supabase/database.types";
import type { ReadClient } from "../../lib/supabase/readDataset";
import { validateRow } from "../../lib/supabase/readDataset.ts";
import { classifyMutationRejection, createMutationLifecycle, MutationError, parsePersistedUuid } from "../../lib/supabase/mutation.ts";
import type { ConfirmedDeletion, ConfirmedPersistence, FollowUp, MutationLifecycle, MutationOptions, PersistedUuid, UncertainMutation } from "../../lib/supabase/mutation";
import { mapOfferRow, mapOfferSave } from "./mappers.ts";
import type { OfferSaveContent, PersistedOffer } from "./mappers";

export type OffersWriteClient = ReadClient & Pick<import("@supabase/supabase-js").SupabaseClient, "rpc">;
export interface OfferSaveIntent { readonly id: string | null; readonly publish: boolean }
export interface ConfirmedOfferPersistence extends ConfirmedPersistence<PersistedOffer> {
  /** save_offer ignored the requested association because publication made it immutable. */
  readonly partnerAssociation?: { readonly outcome: "preserved"; readonly partnerId: PersistedUuid };
}
export type OfferWriteResult = ConfirmedOfferPersistence | UncertainMutation;
export type OfferDeleteResult = ConfirmedDeletion | UncertainMutation;
type WriteRpc = Exclude<keyof OfferRpcContracts, "offer_effective_status">;
const fields = {
  id: "string", partner_id: "nullable-string", title: "string", subtitle: "nullable-string",
  description: "string", publication_mode: "string", has_coupon: "boolean", coupon: "nullable-string",
  has_expiration: "boolean", starts_on: "nullable-string", expires_on: "nullable-string",
  published_at: "nullable-string", enabled: "boolean", deleted_at: "nullable-string",
} as const;
const columns = `${Object.keys(fields).join(",")},effective_status:offer_effective_status`;

/** Isolated RPC writes; no operational state, status calculations or automatic retries. */
export function createOffersWriteRepository(client: OffersWriteClient) {
  async function refresh(id: PersistedUuid, life: MutationLifecycle, options: MutationOptions): Promise<FollowUp<PersistedOffer>> {
    try {
      if (!await life.canApplyResult()) throw new MutationError("stale");
      let query = client.from("offers").select(columns).eq("id", id).is("deleted_at", null).returns<OfferReadRow[]>().retry(false);
      if (options.signal) query = query.abortSignal(options.signal);
      const response = await query.maybeSingle();
      if (!await life.canApplyResult()) throw new MutationError("stale");
      if (response.error) throw classifyMutationRejection(response.error.code, response.status);
      if (!response.data) throw new MutationError("missing");
      validateRow(response.data, { ...fields, effective_status: "nullable-string" });
      const row = response.data as OfferReadRow;
      if (parsePersistedUuid(row.id).toLowerCase() !== id.toLowerCase()) throw new MutationError("response");
      if (row.partner_id !== null) parsePersistedUuid(row.partner_id);
      const value = mapOfferRow(row);
      if (!value) throw new MutationError("response");
      return { state: "completed", value };
    } catch (error) {
      return { state: "failed", error: error instanceof MutationError ? error : new MutationError("response") };
    }
  }

  async function mutate<N extends WriteRpc>(name: N, args: OfferRpcContracts[N]["args"], target: PersistedUuid | undefined, options: MutationOptions): Promise<OfferWriteResult | OfferDeleteResult> {
    const life = await createMutationLifecycle(client, options);
    let query = client.rpc(name, args).retry(false);
    if (options.signal) query = query.abortSignal(options.signal);
    await life.prepareDispatch();
    life.markDispatched();
    let response;
    try { response = await query; }
    catch { return { outcome: "uncertain", id: target, error: life.interruption() }; }
    if (response.error) {
      if (response.status === 0 || response.status >= 500) return { outcome: "uncertain", id: target, error: life.interruption() };
      // Exact migration-defined sentinel only; never propagate the raw server message.
      if (response.error.code === "P0001" && response.error.message === "Unknown Offer") throw new MutationError("missing", "P0001", response.status);
      throw classifyMutationRejection(response.error.code, response.status);
    }
    if (response.status < 200 || response.status >= 300) return { outcome: "uncertain", id: target, error: new MutationError("response") };
    if (name === "soft_delete_offer") {
      // A void RPC acknowledgment confirms deletion without a subsequent visible row.
      if (response.data !== null || !target) return { outcome: "uncertain", id: target, error: new MutationError("response") };
      return { outcome: "confirmed", operation: "delete", id: target, cleanup: { state: "not-needed" } };
    }
    let row: OfferRow;
    let id: PersistedUuid;
    let partnerAssociation: ConfirmedOfferPersistence["partnerAssociation"];
    try {
      // Composite RPC responses can be an object or a singleton row set; no larger sets.
      const data = Array.isArray(response.data) ? response.data.length === 1 ? response.data[0] : null : response.data;
      validateRow(data, fields);
      row = data as OfferRow;
      id = parsePersistedUuid(row.id);
      if (target && id.toLowerCase() !== target.toLowerCase()) throw new MutationError("response");
      if (row.partner_id !== null) parsePersistedUuid(row.partner_id);
      if (row.deleted_at !== null) throw new MutationError("response");
      if (name === "save_offer") {
        const requested = (args as OfferRpcContracts["save_offer"]["args"]).p_partner_id;
        if (row.partner_id?.toLowerCase() !== requested?.toLowerCase()) {
          if (row.published_at === null || row.partner_id === null || !target) throw new MutationError("response");
          partnerAssociation = { outcome: "preserved", partnerId: parsePersistedUuid(row.partner_id) };
        }
      }
    } catch { return { outcome: "uncertain", id: target, error: new MutationError("response") }; }
    return { outcome: "confirmed", operation: "persist", id, partnerAssociation, refresh: await refresh(id, life, options), cleanup: { state: "not-needed" } };
  }

  return {
    save(content: OfferSaveContent, intent: OfferSaveIntent, options: MutationOptions = {}): Promise<OfferWriteResult> {
      if (typeof intent.publish !== "boolean") throw new MutationError("domain");
      const target = intent.id === null ? undefined : parsePersistedUuid(intent.id);
      if (content.partnerId !== undefined) parsePersistedUuid(content.partnerId);
      let args: OfferRpcContracts["save_offer"]["args"];
      try { args = mapOfferSave(content, intent); }
      catch { throw new MutationError("domain"); }
      return mutate("save_offer", args, target, options) as Promise<OfferWriteResult>;
    },
    setEnabled(id: string, enabled: boolean, options: MutationOptions = {}): Promise<OfferWriteResult> {
      if (typeof enabled !== "boolean") throw new MutationError("domain");
      return mutate("set_offer_enabled", { p_id: id, p_enabled: enabled }, parsePersistedUuid(id), options) as Promise<OfferWriteResult>;
    },
    activateScheduled(id: string, options: MutationOptions = {}): Promise<OfferWriteResult> {
      return mutate("activate_scheduled_offer", { p_id: id }, parsePersistedUuid(id), options) as Promise<OfferWriteResult>;
    },
    softDelete(id: string, options: MutationOptions = {}): Promise<OfferDeleteResult> {
      return mutate("soft_delete_offer", { p_id: id }, parsePersistedUuid(id), options) as Promise<OfferDeleteResult>;
    },
  };
}

export const offersWriteRepository = {
  async save(content: OfferSaveContent, intent: OfferSaveIntent, options: MutationOptions = {}): Promise<OfferWriteResult> {
    const { supabase } = await import("../../lib/supabase/client.ts");
    return createOffersWriteRepository(supabase).save(content, intent, options);
  },
  async setEnabled(id: string, enabled: boolean, options: MutationOptions = {}): Promise<OfferWriteResult> {
    const { supabase } = await import("../../lib/supabase/client.ts");
    return createOffersWriteRepository(supabase).setEnabled(id, enabled, options);
  },
  async activateScheduled(id: string, options: MutationOptions = {}): Promise<OfferWriteResult> {
    const { supabase } = await import("../../lib/supabase/client.ts");
    return createOffersWriteRepository(supabase).activateScheduled(id, options);
  },
  async softDelete(id: string, options: MutationOptions = {}): Promise<OfferDeleteResult> {
    const { supabase } = await import("../../lib/supabase/client.ts");
    return createOffersWriteRepository(supabase).softDelete(id, options);
  },
};
