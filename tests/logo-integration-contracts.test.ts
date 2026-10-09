import assert from "node:assert/strict";
import { test } from "node:test";
import { createLogoReconciliationDescriptor, logoStorageExtension, prepareLogoUpload } from "../src/features/partners/logoIntegrationContracts.ts";
import type { LogoIntent, LogoOperationContext, PartnerLogoCommand, PartnerLogoIntegrationOutcome, PreparedLogoRetryCommand, PreparedLogoUpload } from "../src/features/partners/logoIntegrationContracts.ts";
import type { LogoUploadResult } from "../src/features/partners/supabaseLogoRepository.ts";
import { MutationError, parsePersistedUuid } from "../src/lib/supabase/mutation.ts";
import { mapPartnerWrite } from "../src/features/partners/mappers.ts";
import { mapOfferSave } from "../src/features/offers/mappers.ts";

const id = parsePersistedUuid("AAAAAAAA-0000-0000-0000-000000000001");
const context: LogoOperationContext = { operationId: "bbbbbbbb-0000-0000-0000-000000000002", initiatingAdminId: id, target: { kind: "edit", id, expectedLogo: { logo_path: null, logo_name: null } } };
const upload: Extract<LogoUploadResult, { outcome: "confirmed" }> = { outcome: "confirmed", canApply: true, bucket: "partner-logos", objectPath: "logos/cccccccc-0000-0000-0000-000000000003.jpg", originalFilename: "Marca Original.jpeg" };
const prepared = prepareLogoUpload(context, upload);
const descriptor = createLogoReconciliationDescriptor({ context, intent: "replace", uploaded: { state: "confirmed", metadata: upload } });
const fails = (kind: string) => (error: unknown) => error instanceof MutationError && error.kind === kind;

test("explicit intents distinguish keep, local replacement and reference removal", () => {
  const file = new File(["selected"], "local.png");
  const intents: LogoIntent[] = [{ kind: "keep" }, { kind: "replace", file }, { kind: "remove" }];
  assert.deepEqual(intents.map(intent => intent.kind), ["keep", "replace", "remove"]);
  assert.equal("file" in intents[0], false); assert.equal("file" in intents[2], false);
});

for (const format of ["png", "jpg", "jpeg"] as const) test(`${format} input maps to canonical Storage extension`, () => {
  assert.equal(logoStorageExtension(format), format === "png" ? "png" : "jpg");
});

test("unsupported input format is rejected without changing current UI validation", () => {
  assert.throws(() => logoStorageExtension("svg" as "png"), fails("domain"));
});

test("prepared upload retains original operation, target, filename and metadata", () => {
  assert.equal(prepared.kind, "prepared-upload"); assert.equal(prepared.context.operationId, context.operationId);
  assert.equal(prepared.context.initiatingAdminId, id); assert.equal(prepared.metadata.originalFilename, "Marca Original.jpeg");
  assert.equal("file" in prepared, false); assert.equal("publicUrl" in prepared.metadata, false);
  assert.notEqual(prepared.context, context);
});

test("stale acknowledgment cannot construct an applicable prepared upload", () => {
  assert.throws(() => prepareLogoUpload(context, { ...upload, canApply: false }), fails("stale"));
  assert.throws(() => prepareLogoUpload(context, { ...upload, outcome: "uncertain" } as unknown as typeof upload), fails("response"));
});

test("expected metadata preserves nulls and existing filename independently", () => {
  for (const expectedLogo of [{ logo_path: null, logo_name: null }, { logo_path: "legacy/shared.png", logo_name: null }, { logo_path: "legacy/shared.png", logo_name: "Original.png" }]) {
    const result = createLogoReconciliationDescriptor({ context: { ...context, target: { kind: "edit", id, expectedLogo } }, intent: "remove" });
    assert.equal(result.context.target.kind, "edit");
    if (result.context.target.kind === "edit") assert.deepEqual(result.context.target.expectedLogo, expectedLogo);
  }
});

test("impossible metadata pair is rejected", () => {
  assert.throws(() => createLogoReconciliationDescriptor({ context: { ...context, target: { kind: "edit", id, expectedLogo: { logo_path: null, logo_name: "filename" } } }, intent: "keep" }), fails("response"));
});

test("descriptor round-trips as JSON without files, errors, sessions or runtime extras", () => {
  const result = createLogoReconciliationDescriptor({
    context: { ...context, token: "secret-token", target: { ...context.target, credentials: "secret" } } as unknown as LogoOperationContext,
    intent: "replace", uploaded: { state: "confirmed", metadata: { ...upload, session: "secret-session", publicUrl: "secret-url" } as typeof upload },
    rawError: "secret-error", file: new File(["secret-content"], "private"),
  } as Parameters<typeof createLogoReconciliationDescriptor>[0]);
  const json = JSON.stringify(result); assert.doesNotMatch(json, /secret|credentials|session|rawError|publicUrl/);
  assert.deepEqual(JSON.parse(json), result);
});

test("create reconciliation retains missing or known DB UUID explicitly", () => {
  const create = { ...context, target: { kind: "create" as const } };
  const unknown = createLogoReconciliationDescriptor({ context: create, intent: "replace", uploaded: { state: "uncertain", metadata: upload } });
  assert.equal(unknown.persistedPartnerId, undefined); assert.equal(unknown.uploaded?.metadata.objectPath, upload.objectPath);
  const known = createLogoReconciliationDescriptor({ context: create, intent: "none", persistedPartnerId: id });
  assert.equal(known.persistedPartnerId, id);
});

test("creation cannot keep/remove and edit cannot use implicit no-logo intent", () => {
  for (const intent of ["keep", "remove"] as const) assert.throws(() => createLogoReconciliationDescriptor({ context: { ...context, target: { kind: "create" } }, intent }), fails("response"));
  assert.throws(() => createLogoReconciliationDescriptor({ context, intent: "none" }), fails("response"));
});

test("invalid upload paths, target IDs and keep-with-upload descriptors are rejected", () => {
  assert.throws(() => prepareLogoUpload(context, { ...upload, objectPath: `${upload.objectPath}\n` }), fails("response"));
  assert.throws(() => prepareLogoUpload(context, { ...upload, objectPath: "logos/bad.svg" }), fails("response"));
  assert.throws(() => createLogoReconciliationDescriptor({ context, intent: "keep", uploaded: { state: "confirmed", metadata: upload } }), fails("response"));
  assert.throws(() => createLogoReconciliationDescriptor({ context, intent: "replace", persistedPartnerId: parsePersistedUuid(context.operationId) }), fails("response"));
});

test("definitive DB rejection retains prepared upload and permits explicit manual retry contract", () => {
  const failure: Extract<PartnerLogoIntegrationOutcome, { kind: "upload-confirmed-database-rejected" }> = { kind: "upload-confirmed-database-rejected", reconciliation: descriptor, objects: "preserve", prepared, error: new MutationError("domain") };
  const retry: PreparedLogoRetryCommand = { kind: "retry-prepared", after: failure, content: { name: "Brand", website: "brand.example" } };
  assert.equal(retry.after.prepared.metadata.objectPath, upload.objectPath); assert.equal(retry.after.error.retryAutomatically, false);
});

test("upload and DB uncertainty retain reconciliation keys without automatic action", () => {
  const uploadUncertain: PartnerLogoIntegrationOutcome = { kind: "upload-uncertain", objects: "preserve", reconciliation: descriptor, upload: { ...upload, outcome: "uncertain", error: new MutationError("uncertain") } };
  const dbUncertain: PartnerLogoIntegrationOutcome = { kind: "database-uncertain", objects: "preserve", reconciliation: descriptor, prepared, mutation: { outcome: "uncertain", id, error: new MutationError("uncertain") } };
  assert.equal(uploadUncertain.upload.objectPath, upload.objectPath); assert.equal(dbUncertain.mutation.id, id);
});

test("confirmed DB write remains confirmed with failed refresh", () => {
  const result: PartnerLogoIntegrationOutcome = { kind: "confirmed", objects: "preserve", reconciliation: descriptor, persistence: { outcome: "confirmed", operation: "persist", id, refresh: { state: "failed", error: new MutationError("response") }, cleanup: { state: "not-needed" } } };
  assert.equal(result.persistence.outcome, "confirmed"); assert.equal(result.persistence.refresh.state, "failed");
});

test("pre-DB failure, interruption and conflict carry sanitized errors and preserve objects", () => {
  const results: PartnerLogoIntegrationOutcome[] = [
    { kind: "before-database-failure", objects: "preserve", reconciliation: descriptor, error: new MutationError("authorization") },
    { kind: "interrupted", objects: "preserve", reconciliation: descriptor, stage: "after-upload-before-database", reason: "stale", prepared, error: new MutationError("stale") },
    { kind: "logo-conflict", objects: "preserve", reconciliation: descriptor, prepared, error: new MutationError("conflict") },
  ];
  assert.ok(results.every(result => result.objects === "preserve"));
});

test("existing Partner/Offer mapper contracts remain compatible", () => {
  assert.deepEqual(mapPartnerWrite({ name: "Brand", website: "brand.example", logo: { ...prepared.metadata } }), { name: "Brand", website: "brand.example", logo_path: upload.objectPath, logo_name: upload.originalFilename });
  assert.equal(mapOfferSave({ title: "", description: "", publicationMode: "now", hasCoupon: false, hasExpiration: false }, { id: null, publish: false }).p_publish, false);
});

// Compile-time safeguards only; this function is never executed.
function typeContracts() {
  const editContext = { ...context, target: { kind: "edit" as const, id, expectedLogo: { logo_path: null, logo_name: null } } };
  // @ts-expect-error Logo intent is mandatory, omission does not remove anything.
  const omitted: PartnerLogoCommand = { kind: "edit", context: editContext, content: { name: "Brand", website: "brand.example" } };
  // @ts-expect-error Prepared metadata is not a newly selected File.
  const replacement: LogoIntent = { kind: "replace", file: prepared };
  // @ts-expect-error A File is not a confirmed prepared upload.
  const selected: PreparedLogoUpload = new File([], "logo.png");
  const uncertain: Extract<PartnerLogoIntegrationOutcome, { kind: "database-uncertain" }> = { kind: "database-uncertain", reconciliation: descriptor, objects: "preserve", mutation: { outcome: "uncertain", error: new MutationError("uncertain") } };
  // @ts-expect-error Uncertainty is not eligible for manual retry before reconciliation.
  const retry: PreparedLogoRetryCommand = { kind: "retry-prepared", after: uncertain, content: { name: "Brand", website: "brand.example" } };
  // @ts-expect-error No outcome can authorize physical deletion.
  const deletion: PartnerLogoIntegrationOutcome = { kind: "before-database-failure", reconciliation: descriptor, objects: "delete", error: new MutationError("domain") };
  return [omitted, replacement, selected, retry, deletion];
}
void typeContracts;
