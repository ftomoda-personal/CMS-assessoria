import { assertSessionContinuity, createSessionContinuityGuard, MutationError } from "../../lib/supabase/mutation.ts";
import type { SessionContinuityGuard } from "../../lib/supabase/mutation";
import type { ReadClient } from "../../lib/supabase/readDataset";
import { createLogoReconciliationDescriptor, prepareLogoUpload, assertPreparedLogoSession } from "./logoIntegrationContracts.ts";
import type { PartnerLogoCommand, PartnerLogoIntegrationOutcome, PreparedLogoRetryCommand, PreparedLogoUpload, LogoIntegrationOptions } from "./logoIntegrationContracts";
import type { createPartnerLogoRepository } from "./supabaseLogoRepository";
import { getPartnerWriteFailureEvidence } from "./supabaseWriteRepository.ts";
import type { createPartnersWriteRepository } from "./supabaseWriteRepository";

type Outcome = PartnerLogoIntegrationOutcome;
type Rejected = Extract<Outcome, { kind: "upload-confirmed-database-rejected" }>;
/** No singleton or operational wiring. All dependencies must use the same auth client.
 * Only repository evidence proves dispatch/rejection. Unknown exceptions while
 * invoking a repository are conservatively uncertain and never authorize retry.
 */
export function createPartnerLogoIntegration(deps: {
  readonly client: ReadClient;
  readonly logos: Pick<ReturnType<typeof createPartnerLogoRepository>, "upload">;
  readonly partners: Pick<ReturnType<typeof createPartnersWriteRepository>, "create" | "createWithLogo" | "update" | "updateWithLogo">;
}) {
  // Identity, not serializable data, grants a single manual retry attempt.
  const retries = new WeakMap<Rejected, { command: PartnerLogoCommand; guard: SessionContinuityGuard; prepared: PreparedLogoUpload; snapshot: string }>();
  async function run(command: PartnerLogoCommand, options: LogoIntegrationOptions, reuse?: { guard: SessionContinuityGuard; prepared: PreparedLogoUpload }): Promise<Outcome> {
    // Snapshot caller-owned data before asynchronous steps.
    let reconciliation = createLogoReconciliationDescriptor({ context: command.context, intent: command.logo.kind, ...(reuse ? { uploaded: { state: "confirmed" as const, metadata: reuse.prepared.metadata } } : {}) });
    command = { ...command, context: reconciliation.context, content: { name: command.content.name, website: command.content.website }, logo: { ...command.logo } } as PartnerLogoCommand;
    const base = () => ({ objects: "preserve" as const, reconciliation });
    let prepared = reuse?.prepared;
    let guard: SessionContinuityGuard;
    let repositoryInvoked = false;
    let stage: "before-upload" | "after-upload-before-database" = reuse ? "after-upload-before-database" : "before-upload";
    try {
      if (!command.content.name?.trim() || !command.content.website?.trim() || command.kind !== command.context.target.kind) throw new MutationError("domain");
      guard = reuse?.guard ?? options.sessionGuard ?? await createSessionContinuityGuard(deps.client, options);
      const shared = { ...options, sessionGuard: guard };
      const check = async () => {
        await assertSessionContinuity(guard, deps.client, options.signal);
        const session = await deps.client.auth.getSession();
        if (session.error || session.data.session?.user.id.toLowerCase() !== command.context.initiatingAdminId.toLowerCase()) throw new MutationError("stale");
        await assertSessionContinuity(guard, deps.client, options.signal);
      };
      await check();
      if (reuse) {
        await assertPreparedLogoSession(reuse.prepared, guard, deps.client, options.signal);
        reconciliation = createLogoReconciliationDescriptor({ context: command.context, intent: "replace", uploaded: { state: "confirmed", metadata: prepared!.metadata } });
      } else if (command.logo.kind === "replace") {
        const upload = await deps.logos.upload(command.logo.file, shared);
        reconciliation = createLogoReconciliationDescriptor({ context: command.context, intent: "replace", uploaded: { state: upload.outcome, metadata: upload } });
        if (upload.outcome === "uncertain") return { ...base(), kind: "upload-uncertain", upload };
        stage = "after-upload-before-database";
        await check();
        if (!upload.canApply) throw new MutationError("stale");
        prepared = prepareLogoUpload(command.context, upload, guard);
      }
      await check();
      repositoryInvoked = true;
      const target = command.context.target;
      const result = target.kind === "create"
        ? prepared ? await deps.partners.createWithLogo(command.content, prepared, shared) : await deps.partners.create(command.content, shared)
        : command.logo.kind === "keep" ? await deps.partners.update(target.id, command.content, shared)
          : await deps.partners.updateWithLogo(target.id, command.content, target.expectedLogo, prepared ?? null, shared);
      reconciliation = createLogoReconciliationDescriptor({ ...reconciliation, persistedPartnerId: result.id });
      if (result.outcome === "uncertain") return { ...base(), kind: "database-uncertain", mutation: result, prepared };
      return { ...base(), kind: "confirmed", persistence: result };
    } catch (caught) {
      const error = caught instanceof MutationError ? caught : new MutationError(repositoryInvoked ? "uncertain" : "response");
      const evidence = getPartnerWriteFailureEvidence(error);
      if (evidence?.state === "logo-conflict") return { ...base(), kind: "logo-conflict", error, prepared };
      if (evidence?.state === "zero-row") return { ...base(), kind: "zero-row", error, prepared };
      if (evidence?.state === "database-rejected") {
        if (prepared && evidence.retryEligible) {
          // Authorization must still be live when issued, not only on reuse.
          try { await assertPreparedLogoSession(prepared, guard!, deps.client, options.signal); }
          catch (failure) {
            const interrupted = failure instanceof MutationError ? failure : new MutationError("stale");
            if (interrupted.kind === "stale" || interrupted.kind === "cancelled") return { ...base(), kind: "interrupted", stage, reason: interrupted.kind, error: interrupted, prepared };
            return { ...base(), kind: "database-rejected", error, prepared };
          }
          const outcome: Rejected = { ...base(), kind: "upload-confirmed-database-rejected", prepared, error };
          retries.set(outcome, { command, guard: guard!, prepared, snapshot: JSON.stringify(prepared) });
          return outcome;
        }
        return { ...base(), kind: "database-rejected", error, prepared };
      }
      if (error.kind === "uncertain") return { ...base(), kind: "database-uncertain", mutation: { outcome: "uncertain", error, id: command.context.target.kind === "edit" ? command.context.target.id : undefined }, prepared };
      if (error.kind === "cancelled" || error.kind === "stale") return { ...base(), kind: "interrupted", stage, reason: error.kind, error, prepared };
      return { ...base(), kind: "before-database-failure", error, prepared };
    }
  }
  return {
    execute(command: PartnerLogoCommand, options: LogoIntegrationOptions = {}): Promise<Outcome> { return run(command, options); },
    async retry(command: PreparedLogoRetryCommand, options: LogoIntegrationOptions = {}): Promise<Outcome> {
      const eligible = retries.get(command.after);
      if (!eligible || command.after.prepared !== eligible.prepared || JSON.stringify(eligible.prepared) !== eligible.snapshot || (options.sessionGuard && options.sessionGuard !== eligible.guard)) throw new MutationError("stale");
      retries.delete(command.after);
      return run({ ...eligible.command, content: command.content }, options, eligible);
    },
  };
}
