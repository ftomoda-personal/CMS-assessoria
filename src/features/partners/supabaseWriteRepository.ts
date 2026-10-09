import type { PartnerRow } from "../../lib/supabase/database.types";
import type { ReadClient } from "../../lib/supabase/readDataset";
import { validateRow } from "../../lib/supabase/readDataset.ts";
import { classifyMutationRejection, createMutationLifecycle, MutationError, parsePersistedUuid } from "../../lib/supabase/mutation.ts";
import type { ConfirmedDeletion, ConfirmedPersistence, FollowUp, MutationLifecycle, MutationOptions, PersistedUuid, UncertainMutation } from "../../lib/supabase/mutation";
import { mapPartnerRow } from "./mappers.ts";
import type { PersistedPartner } from "./mappers";

export interface PartnerEditableContent { readonly name: string; readonly website: string }
export type PartnerWriteResult = ConfirmedPersistence<PersistedPartner> | UncertainMutation;
export type PartnerDeleteResult = ConfirmedDeletion | UncertainMutation;
const columns = "id,name,website,logo_path,logo_name,ever_associated";

function editable(content: PartnerEditableContent): PartnerEditableContent {
  if (typeof content.name !== "string" || typeof content.website !== "string" || !content.name.trim() || !content.website.trim()) throw new MutationError("domain");
  // Explicit whitelist: even extra runtime properties cannot reach the database.
  return { name: content.name, website: content.website };
}

/** Isolated writes only. No UI/cache integration, Storage calls or Offer derivation. */
export function createPartnersWriteRepository(client: ReadClient) {
  async function refresh(id: PersistedUuid, life: MutationLifecycle, options: MutationOptions): Promise<FollowUp<PersistedPartner>> {
    try {
      if (!await life.canApplyResult()) throw new MutationError("stale");
      let query = client.from("partners").select(columns).eq("id", id).retry(false);
      if (options.signal) query = query.abortSignal(options.signal);
      const response = await query.maybeSingle();
      if (!await life.canApplyResult()) throw new MutationError("stale");
      if (response.error) throw classifyMutationRejection(response.error.code, response.status);
      if (!response.data) throw new MutationError("missing");
      validateRow(response.data, { id: "string", name: "string", website: "string", logo_path: "nullable-string", logo_name: "nullable-string", ever_associated: "boolean" });
      if (parsePersistedUuid(response.data.id).toLowerCase() !== id.toLowerCase()) throw new MutationError("response");
      return { state: "completed", value: mapPartnerRow(response.data as PartnerRow) };
    } catch (error) {
      return { state: "failed", error: error instanceof MutationError ? error : new MutationError("response") };
    }
  }

  async function mutate(operation: "create" | "update" | "delete", content: PartnerEditableContent | undefined, target: PersistedUuid | undefined, options: MutationOptions): Promise<PartnerWriteResult | PartnerDeleteResult> {
    const life = await createMutationLifecycle(client, options);
    const mutation = operation === "create" ? client.from("partners").insert(content!)
      : operation === "update" ? client.from("partners").update(content!).eq("id", target!)
      : client.from("partners").delete().eq("id", target!);
    let query = mutation.select(operation === "delete" ? "id,logo_path" : "id").returns<Record<string, unknown>[]>().retry(false);
    if (options.signal) query = query.abortSignal(options.signal);
    await life.prepareDispatch();
    life.markDispatched();
    let response;
    try { response = await query; }
    catch { return { outcome: "uncertain", id: target, error: life.interruption() }; }
    if (response.error) {
      // SDK transport failures have status 0. Gateway/server failures may hide a commit.
      if (response.status === 0 || response.status >= 500) return { outcome: "uncertain", id: target, error: life.interruption() };
      throw classifyMutationRejection(response.error.code, response.status);
    }
    if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data)) return { outcome: "uncertain", id: target, error: new MutationError("response") };
    if (response.data.length === 0) {
      if (operation === "create") return { outcome: "uncertain", error: new MutationError("response") };
      throw new MutationError("missing");
    }
    if (response.data.length !== 1) return { outcome: "uncertain", id: target, error: new MutationError("response") };
    let id: PersistedUuid;
    try {
      id = parsePersistedUuid(response.data[0]?.id);
      if (target && id.toLowerCase() !== target.toLowerCase()) throw new MutationError("response");
    } catch { return { outcome: "uncertain", id: target, error: new MutationError("response") }; }
    if (operation === "delete") {
      // Unknown logo metadata is conservatively pending, never claimed as removed.
      return { outcome: "confirmed", operation: "delete", id, cleanup: { state: response.data[0].logo_path === null ? "not-needed" : "pending" } };
    }
    return { outcome: "confirmed", operation: "persist", id, refresh: await refresh(id, life, options), cleanup: { state: "not-needed" } };
  }

  return {
    create(content: PartnerEditableContent, options: MutationOptions = {}): Promise<PartnerWriteResult> {
      return mutate("create", editable(content), undefined, options) as Promise<PartnerWriteResult>;
    },
    update(id: string, content: PartnerEditableContent, options: MutationOptions = {}): Promise<PartnerWriteResult> {
      return mutate("update", editable(content), parsePersistedUuid(id), options) as Promise<PartnerWriteResult>;
    },
    remove(id: string, options: MutationOptions = {}): Promise<PartnerDeleteResult> {
      return mutate("delete", undefined, parsePersistedUuid(id), options) as Promise<PartnerDeleteResult>;
    },
  };
}

export const partnersWriteRepository = {
  async create(content: PartnerEditableContent, options: MutationOptions = {}): Promise<PartnerWriteResult> {
    const { supabase } = await import("../../lib/supabase/client.ts");
    return createPartnersWriteRepository(supabase).create(content, options);
  },
  async update(id: string, content: PartnerEditableContent, options: MutationOptions = {}): Promise<PartnerWriteResult> {
    const { supabase } = await import("../../lib/supabase/client.ts");
    return createPartnersWriteRepository(supabase).update(id, content, options);
  },
  async remove(id: string, options: MutationOptions = {}): Promise<PartnerDeleteResult> {
    const { supabase } = await import("../../lib/supabase/client.ts");
    return createPartnersWriteRepository(supabase).remove(id, options);
  },
};
