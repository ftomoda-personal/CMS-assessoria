import type { PartnerRow } from "../../lib/supabase/database.types";
import { ReadRepositoryError, readDataset, validateRow } from "../../lib/supabase/readDataset.ts";
import type { ReadClient, ReadOptions } from "../../lib/supabase/readDataset";
import { assertSessionContinuity, createSessionContinuityGuard, MutationError, parsePersistedUuid } from "../../lib/supabase/mutation.ts";
import type { SessionContinuityGuard } from "../../lib/supabase/mutation";
import { mapPartnerRow } from "./mappers.ts";
import type { PersistedPartner } from "./mappers";

export interface PartnerReadByIdOptions extends ReadOptions { readonly sessionGuard?: SessionContinuityGuard }
export type PartnerReadByIdResult =
  | { readonly kind: "found"; readonly partner: PersistedPartner }
  | { readonly kind: "invalid-id" }
  | { readonly kind: "authorization-denied" }
  | { readonly kind: "session-interrupted" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failure"; readonly reason: "service" | "response" | "mapping" }
  | { readonly kind: "inconclusive"; readonly reason: "absent-or-invisible" };

const columns = "id,name,website,logo_path,logo_name,ever_associated";
const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** Isolated read-only API. No operational imports, cache, URL resolver or mutations. */
export function createPartnersReadRepository(client: ReadClient) {
  return {
    /** Empty RLS-filtered reads never prove nonexistence. No write/cache/Storage work. */
    async readById(id: string, options: PartnerReadByIdOptions = {}): Promise<PartnerReadByIdResult> {
      let target: string;
      try {
        if (typeof id !== "string" || id.length !== 36) return { kind: "invalid-id" };
        target = parsePersistedUuid(id);
      } catch { return { kind: "invalid-id" }; }
      const { signal } = options;
      let guard: SessionContinuityGuard | undefined;
      try {
        if (signal?.aborted) throw new MutationError("cancelled");
        guard = options.sessionGuard ?? await createSessionContinuityGuard(client, { signal });
        const check = () => assertSessionContinuity(guard!, client, signal);
        const verifyResponse = (response: { status: number; error: { code?: string } | null }) => {
          if (response.error && (response.status === 401 || response.status === 403 || response.error.code === "42501")) throw new ReadRepositoryError("authorization");
          if (response.error || response.status < 200 || response.status >= 300) throw new ReadRepositoryError("query");
        };
        const authorize = async () => {
          await check();
          const current = await client.auth.getSession();
          await check();
          if (current.error || !current.data.session) throw new ReadRepositoryError("authorization");
          const userId = parsePersistedUuid(current.data.session.user.id);
          let query = client.from("cms_admins").select("user_id").eq("user_id", userId).retry(false);
          if (signal) query = query.abortSignal(signal);
          await check();
          const response = await query.maybeSingle();
          await check();
          verifyResponse(response);
          if (response.data?.user_id !== userId) throw new ReadRepositoryError("authorization");
        };
        await authorize();
        let query = client.from("partners").select(columns).eq("id", target).retry(false);
        if (signal) query = query.abortSignal(signal);
        await check();
        const response = await query.maybeSingle();
        await check();
        verifyResponse(response);
        // Detect admin revocation before returning either a row or an empty result.
        await authorize();
        if (response.data === null) return { kind: "inconclusive", reason: "absent-or-invisible" };
        try {
          validateRow(response.data, { id: "string", name: "string", website: "string", logo_path: "nullable-string", logo_name: "nullable-string", ever_associated: "boolean" });
          if (parsePersistedUuid(response.data.id).toLowerCase() !== target.toLowerCase()) return { kind: "failure", reason: "response" };
          return { kind: "found", partner: mapPartnerRow(response.data as PartnerRow) };
        } catch { return { kind: "failure", reason: "mapping" }; }
      } catch (error) {
        // Also discard late transport failures from a cancelled/replaced session.
        if (signal?.aborted) return { kind: "cancelled" };
        if (guard) {
          try { await assertSessionContinuity(guard, client, signal); }
          catch { return { kind: signal?.aborted ? "cancelled" : "session-interrupted" }; }
        }
        if (error instanceof MutationError) {
          if (error.kind === "cancelled") return { kind: "cancelled" };
          if (error.kind === "stale") return { kind: "session-interrupted" };
          if (error.kind === "authorization") return { kind: "authorization-denied" };
        }
        if (error instanceof ReadRepositoryError && error.kind === "authorization") return { kind: "authorization-denied" };
        return { kind: "failure", reason: "service" };
      }
    },
    async readAll(options: ReadOptions = {}): Promise<readonly PersistedPartner[]> {
      const partners = await readDataset(client, { table: "partners", columns, map(row) {
        validateRow(row, { id: "string", name: "string", website: "string", logo_path: "nullable-string", logo_name: "nullable-string", ever_associated: "boolean" });
        return mapPartnerRow(row as PartnerRow);
      } }, options);
      return Object.freeze([...partners].sort((a, b) => collator.compare(a.name, b.name) || (a.id.toLowerCase() < b.id.toLowerCase() ? -1 : a.id.toLowerCase() > b.id.toLowerCase() ? 1 : 0)));
    },
  };
}

export const partnersReadRepository = {
  async readById(id: string, options: PartnerReadByIdOptions = {}): Promise<PartnerReadByIdResult> {
    const { supabase } = await import("../../lib/supabase/client.ts");
    return createPartnersReadRepository(supabase).readById(id, options);
  },
  async readAll(options: ReadOptions = {}): Promise<readonly PersistedPartner[]> {
    const { supabase } = await import("../../lib/supabase/client.ts");
    return createPartnersReadRepository(supabase).readAll(options);
  },
};
