import { parsePersistedUuid } from "../../lib/supabase/mutation.ts";
import { createLogoReconciliationDescriptor } from "./logoIntegrationContracts.ts";
import type { PartnerLogoIntegrationOutcome } from "./logoIntegrationContracts";
import type { PersistedPartner } from "./mappers";
import type { PartnerReadByIdOptions, PartnerReadByIdResult } from "./supabaseReadRepository";

export type PartnerReconciliationObservation =
  | { readonly kind: "uploaded-reference-matches" | "uploaded-reference-differs"; readonly partner: PersistedPartner }
  | { readonly kind: "partner-found-history-unestablished"; readonly partner: PersistedPartner }
  | { readonly kind: "unresolved"; readonly reason: "missing-partner-id" | "invalid-partner-id" | "invalid-descriptor"; readonly requires: "durable-correlation" | "technical-investigation" }
  | Exclude<PartnerReadByIdResult, { kind: "found" | "invalid-id" }>;
export type PartnerReconciliationAction = "refresh-current-data" | "review-and-decide-outside-service" | "correct-input-outside-service" | "technical-investigation" | "keep-writes-blocked";
export interface PartnerReconciliationResult {
  /** Original evidence retained unchanged; a current read cannot rewrite history. */
  readonly historical: PartnerLogoIntegrationOutcome;
  readonly observation: PartnerReconciliationObservation;
  readonly nextActions: readonly PartnerReconciliationAction[];
  readonly retryAuthorization: "none";
  readonly objects: "preserve";
}

/** Read-only observations, never proof of the original commit or non-commit.
 * DI deliberately exposes no mutations, retry capabilities or Storage methods.
 * A guard supplied by the caller is forwarded unchanged. Without it readById
 * establishes a new read session, never continuity of a historical retry grant.
 */
export function createPartnerReconciliation(reads: {
  readById(id: string, options?: PartnerReadByIdOptions): Promise<PartnerReadByIdResult>;
}) {
  return {
    async reconcile(historical: PartnerLogoIntegrationOutcome, options: PartnerReadByIdOptions = {}): Promise<PartnerReconciliationResult> {
      const finish = (observation: PartnerReconciliationObservation): PartnerReconciliationResult => {
        const nextActions: PartnerReconciliationAction[] = ["keep-writes-blocked"];
        if ("partner" in observation) {
          nextActions.push("refresh-current-data");
          if (observation.kind === "uploaded-reference-differs") nextActions.push("review-and-decide-outside-service");
        } else if (observation.kind === "inconclusive" || observation.kind === "failure" || observation.kind === "unresolved") {
          nextActions.push("technical-investigation");
        }
        if (historical.kind === "database-rejected" || historical.kind === "upload-confirmed-database-rejected" || historical.kind === "before-database-failure") nextActions.push("correct-input-outside-service");
        return { historical, observation, nextActions: Object.freeze(nextActions), retryAuthorization: "none", objects: "preserve" };
      };
      const source = historical.reconciliation;
      // Validate/copy the descriptor before awaiting; caller edits cannot redirect
      // the lookup or alter the expected comparison while a read is pending.
      let descriptor;
      try {
        const targetId = source.context.target.kind === "edit" ? source.context.target.id : source.persistedPartnerId;
        if (targetId !== undefined) {
          try {
            if (typeof targetId !== "string" || targetId.length !== 36) throw new Error("Invalid ID");
            parsePersistedUuid(targetId);
          } catch { return finish({ kind: "unresolved", reason: "invalid-partner-id", requires: "technical-investigation" }); }
        }
        if (source.version !== 1) throw new Error("Invalid descriptor version");
        descriptor = createLogoReconciliationDescriptor(source);
      } catch {
        return finish({ kind: "unresolved", reason: "invalid-descriptor", requires: "technical-investigation" });
      }
      const id = descriptor.context.target.kind === "edit" ? descriptor.context.target.id : descriptor.persistedPartnerId;
      if (!id) return finish({ kind: "unresolved", reason: "missing-partner-id", requires: "durable-correlation" });
      let result: PartnerReadByIdResult;
      try { result = await reads.readById(id, options); }
      catch { return finish(options.signal?.aborted ? { kind: "cancelled" } : { kind: "failure", reason: "service" }); }
      if (options.signal?.aborted) return finish({ kind: "cancelled" });
      if (result.kind === "invalid-id") return finish({ kind: "unresolved", reason: "invalid-partner-id", requires: "technical-investigation" });
      if (result.kind !== "found") return finish(result);
      const upload = descriptor.uploaded;
      if (!upload) return finish({ kind: "partner-found-history-unestablished", partner: result.partner });
      const logo = result.partner.logo;
      const matches = logo?.bucket === upload.metadata.bucket && logo.objectPath === upload.metadata.objectPath && logo.originalFilename === upload.metadata.originalFilename;
      return finish({ kind: matches ? "uploaded-reference-matches" : "uploaded-reference-differs", partner: result.partner });
    },
  };
}
