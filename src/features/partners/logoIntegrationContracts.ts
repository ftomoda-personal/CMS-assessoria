import type { PartnerRow } from "../../lib/supabase/database.types";
import { assertSessionContinuity, MutationError, parsePersistedUuid } from "../../lib/supabase/mutation.ts";
import type { SessionContinuityGuard } from "../../lib/supabase/mutation";
import type { ReadClient } from "../../lib/supabase/readDataset";
import type { ConfirmedPersistence, MutationOptions, PersistedUuid, UncertainMutation } from "../../lib/supabase/mutation";
import type { PersistedPartner } from "./mappers";
import type { PartnerEditableContent } from "./supabaseWriteRepository";
import type { LogoUploadMetadata, LogoUploadResult } from "./supabaseLogoRepository";

export type PartnerLogoInputFormat = "png" | "jpg" | "jpeg";
export function logoStorageExtension(format: PartnerLogoInputFormat): "png" | "jpg" {
  if (format === "png") return "png";
  if (format === "jpg" || format === "jpeg") return "jpg";
  throw new MutationError("domain");
}
export type LogoIntent =
  | { readonly kind: "keep" }
  | { readonly kind: "replace"; readonly file: File }
  | { readonly kind: "remove" };
/** Create cannot keep an unknown reference; absence must be explicit. */
export type CreateLogoIntent = { readonly kind: "none" } | Extract<LogoIntent, { kind: "replace" }>;
export type LogoMetadataReference = Pick<PartnerRow, "logo_path" | "logo_name">;
export type LogoOperationTarget =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly id: PersistedUuid; readonly expectedLogo: LogoMetadataReference };
export interface LogoOperationContext {
  /** Per-operation UUID, not an idempotency key supported by the current database. */
  readonly operationId: string;
  readonly initiatingAdminId: PersistedUuid;
  readonly target: LogoOperationTarget;
}

/** Historical acknowledgment only: not proof of existence or current authorization.
 * Retry must recheck operation/target/admin identity, intent, expected metadata and
 * current session/membership. No credentials or session snapshot are retained here.
 */
export interface PreparedLogoUpload {
  readonly kind: "prepared-upload";
  readonly context: LogoOperationContext;
  readonly metadata: LogoUploadMetadata;
}
// Association deliberately stays outside serializable prepared metadata/descriptors.
const preparedSessionGuards = new WeakMap<PreparedLogoUpload, SessionContinuityGuard>();

/** Same object instance only. Reload/JSON round-trip requires a separate reconciliation
 * and authorization policy; an administrator UUID or descriptor is never sufficient.
 */
export async function assertPreparedLogoSession(prepared: PreparedLogoUpload, guard: SessionContinuityGuard | undefined, client: ReadClient, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new MutationError("cancelled");
  const bound = preparedSessionGuards.get(prepared);
  if (!bound && !guard) return; // Backward-compatible unguarded callers only.
  if (!guard || bound !== guard) throw new MutationError("stale");
  await assertSessionContinuity(guard, client, signal);
}
export type PartnerLogoCommand =
  | { readonly kind: "create"; readonly context: LogoOperationContext & { readonly target: { readonly kind: "create" } }; readonly content: PartnerEditableContent; readonly logo: CreateLogoIntent }
  | { readonly kind: "edit"; readonly context: LogoOperationContext & { readonly target: Extract<LogoOperationTarget, { kind: "edit" }> }; readonly content: PartnerEditableContent; readonly logo: LogoIntent };

/** Serializable allowlist only. No storage mechanism is selected or implemented.
 * Paths/filenames/user IDs still require retention/access decisions before persistence.
 * Missing create UUID prevents definitive DB reconciliation; content is not retained.
 * Name/website concurrency protection is deferred; expectedLogo protects only logos.
 */
export interface LogoReconciliationDescriptor {
  readonly version: 1;
  readonly context: LogoOperationContext;
  readonly intent: "none" | LogoIntent["kind"];
  readonly uploaded?: { readonly state: "confirmed" | "uncertain"; readonly metadata: LogoUploadMetadata };
  readonly persistedPartnerId?: PersistedUuid;
}
interface IntegrationOutcomeContext {
  readonly reconciliation: LogoReconciliationDescriptor;
  /** Removing a reference NEVER authorizes physical deletion, even on failure. */
  readonly objects: "preserve";
}
export type PartnerLogoIntegrationOutcome = IntegrationOutcomeContext & (
  | { readonly kind: "confirmed"; readonly persistence: ConfirmedPersistence<PersistedPartner> }
  | { readonly kind: "before-database-failure"; readonly error: MutationError }
  | { readonly kind: "upload-confirmed-database-rejected"; readonly prepared: PreparedLogoUpload; readonly error: MutationError }
  | { readonly kind: "upload-uncertain"; readonly upload: Extract<LogoUploadResult, { outcome: "uncertain" }> }
  | { readonly kind: "database-uncertain"; readonly mutation: UncertainMutation; readonly prepared?: PreparedLogoUpload }
  | { readonly kind: "interrupted"; readonly stage: "before-upload" | "after-upload-before-database"; readonly reason: "cancelled" | "stale"; readonly error: MutationError; readonly prepared?: PreparedLogoUpload }
  | { readonly kind: "logo-conflict"; readonly error: MutationError; readonly prepared?: PreparedLogoUpload }
);

/** Only this definitive rejection variant is eligible to initiate manual retry.
 * Uncertainty must first be reconciled into a definitive state; never auto-retry.
 */
export interface PreparedLogoRetryCommand {
  readonly kind: "retry-prepared";
  readonly after: Extract<PartnerLogoIntegrationOutcome, { kind: "upload-confirmed-database-rejected" }>;
  readonly content: PartnerEditableContent;
}
export type LogoIntegrationOptions = MutationOptions;

function copyContext(context: LogoOperationContext): LogoOperationContext {
  parsePersistedUuid(context.operationId);
  const initiatingAdminId = parsePersistedUuid(context.initiatingAdminId);
  if (context.target.kind === "create") return { operationId: context.operationId, initiatingAdminId, target: { kind: "create" } };
  if (context.target.kind !== "edit") throw new MutationError("response");
  const { logo_path, logo_name } = context.target.expectedLogo;
  if ((logo_path !== null && typeof logo_path !== "string") || (logo_name !== null && typeof logo_name !== "string") || (logo_path === null && logo_name !== null)) throw new MutationError("response");
  return { operationId: context.operationId, initiatingAdminId, target: { kind: "edit", id: parsePersistedUuid(context.target.id), expectedLogo: { logo_path, logo_name } } };
}
function copyMetadata(metadata: LogoUploadMetadata): LogoUploadMetadata {
  const match = /^logos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](png|jpg)$/.exec(metadata.objectPath);
  if (metadata.bucket !== "partner-logos" || !match || match[0] !== metadata.objectPath || typeof metadata.originalFilename !== "string") throw new MutationError("response");
  return { bucket: "partner-logos", objectPath: metadata.objectPath, originalFilename: metadata.originalFilename };
}

/** Pure constructor, no upload or DB action. Only accepts an applicable confirmation. */
export function prepareLogoUpload(context: LogoOperationContext, upload: Extract<LogoUploadResult, { outcome: "confirmed" }>, guard?: SessionContinuityGuard): PreparedLogoUpload {
  if (upload.outcome !== "confirmed") throw new MutationError("response");
  if (!upload.canApply) throw new MutationError("stale");
  const prepared: PreparedLogoUpload = { kind: "prepared-upload", context: copyContext(context), metadata: copyMetadata(upload) };
  if (guard) preparedSessionGuards.set(prepared, guard);
  return prepared;
}

/** Copies only declared fields, dropping accidental runtime credentials/raw payloads. */
export function createLogoReconciliationDescriptor(input: Omit<LogoReconciliationDescriptor, "version">): LogoReconciliationDescriptor {
  const context = copyContext(input.context);
  if (!["none", "keep", "replace", "remove"].includes(input.intent) || (context.target.kind === "create" ? input.intent !== "none" && input.intent !== "replace" : input.intent === "none")) throw new MutationError("response");
  if (input.uploaded && (input.intent !== "replace" || !["confirmed", "uncertain"].includes(input.uploaded.state))) throw new MutationError("response");
  const persistedPartnerId = input.persistedPartnerId === undefined ? undefined : parsePersistedUuid(input.persistedPartnerId);
  if (context.target.kind === "edit" && persistedPartnerId && persistedPartnerId.toLowerCase() !== context.target.id.toLowerCase()) throw new MutationError("response");
  return {
    version: 1, context, intent: input.intent,
    ...(input.uploaded ? { uploaded: { state: input.uploaded.state, metadata: copyMetadata(input.uploaded.metadata) } } : {}),
    ...(persistedPartnerId ? { persistedPartnerId } : {}),
  };
}
