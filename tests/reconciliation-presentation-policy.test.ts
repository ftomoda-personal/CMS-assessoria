import assert from "node:assert/strict";
import { test } from "node:test";
import { presentPartnerReconciliation } from "../src/features/partners/reconciliationPresentationPolicy.ts";
import { MutationError, parsePersistedUuid } from "../src/lib/supabase/mutation.ts";
import { createLogoReconciliationDescriptor, prepareLogoUpload } from "../src/features/partners/logoIntegrationContracts.ts";
const id = parsePersistedUuid("aaaaaaaa-0000-0000-0000-000000000001");
const admin = parsePersistedUuid("bbbbbbbb-0000-0000-0000-000000000002");
const path = `logos/${id}.png`;
const partner = { id, name: "Private", website: "private.example", everAssociated: false, logo: { bucket: "partner-logos", objectPath: path, originalFilename: "Original" } };
const observed = { kind: "uploaded-reference-matches", partner };
const context = { operationId: id, initiatingAdminId: admin, target: { kind: "edit" as const, id, expectedLogo: { logo_path: null, logo_name: null } } };
const upload = { outcome: "confirmed" as const, canApply: true, bucket: "partner-logos" as const, objectPath: path, originalFilename: "Original" };
const descriptor = () => createLogoReconciliationDescriptor({ context, intent: "replace", uploaded: { state: "confirmed", metadata: upload } });
// Construct complete legitimate contract fixtures; test-specific corruption is
// applied after construction in the malformed-input regressions below.
function report(input: unknown, observation: unknown = observed) {
  const h = input as Record<string, unknown>;
  let historical: Record<string, unknown> = { objects: "preserve", reconciliation: descriptor(), ...h };
  if (["database-rejected", "upload-confirmed-database-rejected", "logo-conflict", "zero-row", "before-database-failure"].includes(String(h.kind))) {
    const error = h.error as { kind?: string; code?: string } | undefined;
    historical = { ...historical, error: new MutationError((error?.kind ?? (h.kind === "logo-conflict" ? "conflict" : "response")) as ConstructorParameters<typeof MutationError>[0], error?.code) };
  }
  if (h.kind === "upload-confirmed-database-rejected") Object.assign(historical, { prepared: prepareLogoUpload(context, upload) });
  if (h.kind === "database-uncertain") Object.assign(historical, { mutation: { outcome: "uncertain", id, error: new MutationError("uncertain") } });
  if (h.kind === "upload-uncertain") Object.assign(historical, { reconciliation: { ...descriptor(), uploaded: { state: "uncertain", metadata: upload } }, upload: { ...upload, outcome: "uncertain", error: new MutationError("uncertain") } });
  if (h.kind === "interrupted") Object.assign(historical, { stage: "after-upload-before-database", error: new MutationError(h.reason as "cancelled" | "stale") });
  if ((observation as { reason?: string })?.reason === "missing-partner-id") Object.assign(historical, { reconciliation: createLogoReconciliationDescriptor({ context: { ...context, target: { kind: "create" } }, intent: "none" }) });
  if ((observation as { kind?: string })?.kind === "partner-found-history-unestablished") Object.assign(historical, { reconciliation: createLogoReconciliationDescriptor({ context, intent: "keep" }) });
  return { historical, observation, nextActions: ["retry", "delete"], retryAuthorization: "none", objects: "preserve" };
}
const confirmed = (state = "completed") => ({ kind: "confirmed", persistence: { outcome: "confirmed", operation: "persist", id, refresh: state === "completed" ? { state, value: partner } : state === "failed" ? { state, error: new MutationError("response") } : { state }, cleanup: { state: "not-needed" } } });
for (const [historical, state] of [
  [confirmed(), "confirmed-historical-success"], [confirmed("failed"), "confirmed-with-failed-refresh"],
  [{ kind: "database-rejected", error: { kind: "domain", code: "23514" } }, "correctable-rejection"],
  [{ kind: "upload-confirmed-database-rejected", error: { kind: "domain", code: "23503" } }, "correctable-rejection"],
  [{ kind: "logo-conflict" }, "metadata-conflict"], [{ kind: "database-rejected", error: { kind: "conflict", code: "23505" } }, "database-conflict"],
  [{ kind: "database-uncertain" }, "database-uncertain"], [{ kind: "upload-uncertain" }, "upload-uncertain"],
  [{ kind: "before-database-failure" }, "preflight-failure"], [{ kind: "zero-row" }, "historical-zero-row"],
  [{ kind: "interrupted", reason: "stale" }, "session-interrupted"], [{ kind: "interrupted", reason: "cancelled" }, "cancelled"],
  [{ kind: "database-rejected", error: { kind: "authorization" } }, "rejection-needs-investigation"],
] as const) test(`historical presentation ${state}`, () => {
  const result = presentPartnerReconciliation(report(historical)); assert.equal(result.state, state);
  assert.equal(result.historical.source, "caller-supplied"); assert.equal(result.historical.authenticatedProof, false);
  assert.equal(result.serverHistoricalEvidence, "unavailable"); assert.equal(result.retryAuthorization, "none"); assert.equal(result.writes, "blocked"); assert.equal(result.storage, "preserve");
  assert.ok(result.actions.includes("keep-writes-blocked")); assert.doesNotMatch(JSON.stringify(result), /23514|23503|23505|logos\/|aaaaaaaa|private.example|Private/);
});
for (const [observation, state] of [
  [{ kind: "inconclusive", reason: "absent-or-invisible" }, "inconclusive"],
  [{ kind: "authorization-denied" }, "authorization-denied"], [{ kind: "session-interrupted" }, "session-interrupted"],
  [{ kind: "cancelled" }, "cancelled"], [{ kind: "failure", reason: "service" }, "service-failure"],
  [{ kind: "failure", reason: "mapping" }, "service-failure"],
  [{ kind: "unresolved", reason: "missing-partner-id", requires: "durable-correlation" }, "durable-correlation-required"],
] as const) test(`current observation ${state} overrides success without rewriting history`, () => {
  const result = presentPartnerReconciliation(report(confirmed(), observation)); assert.equal(result.state, state);
  assert.equal(result.historical.state, "confirmed-historical-success"); assert.equal(result.retryAuthorization, "none");
  assert.equal(result.actions.includes("correct-inputs-outside-policy"), false);
});
for (const kind of ["uploaded-reference-matches", "uploaded-reference-differs", "partner-found-history-unestablished"]) test(`metadata observation ${kind} preserves uncertain history`, () => {
  const result = presentPartnerReconciliation(report({ kind: "database-uncertain" }, { ...observed, kind, partner: kind === "uploaded-reference-differs" ? { ...partner, logo: undefined } : partner }));
  assert.equal(result.state, "database-uncertain"); assert.equal(result.current.source, "reconciliation-read-report");
  assert.ok(result.actions.includes("review-current-partner")); assert.equal(result.historical.authenticatedProof, false);
});
test("confirmed persistence with failed refresh recommends reading only", () => {
  const result = presentPartnerReconciliation(report(confirmed("failed"))); assert.equal(result.state, "confirmed-with-failed-refresh");
  assert.ok(result.actions.includes("refresh-current-data")); assert.doesNotMatch(result.actions.join(" "), /retry|resubmit|upload|delete/);
});
test("fabricated and serialized history cannot become authenticated proof", () => {
  const fabricated = report(confirmed());
  for (const input of [fabricated, JSON.parse(JSON.stringify(fabricated))]) {
    const result = presentPartnerReconciliation(input); assert.equal(result.historical.source, "caller-supplied"); assert.equal(result.historical.authenticatedProof, false);
    assert.equal(result.serverHistoricalEvidence, "unavailable"); assert.equal(result.writes, "blocked"); assert.equal(result.retryAuthorization, "none");
  }
});
test("presentation is frozen primitive summary, independent of mutable caller references", () => {
  const input = report(confirmed("failed"), { ...observed }); const result = presentPartnerReconciliation(input);
  Object.assign(input.historical as object, { kind: "database-uncertain" }); Object.assign(input.observation as object, { partner: { name: "Changed" } });
  assert.equal(result.historical.state, "confirmed-with-failed-refresh");
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.historical)); assert.ok(Object.isFrozen(result.current)); assert.ok(Object.isFrozen(result.actions));
  assert.equal("partner" in result.current, false); assert.equal("reconciliation" in result.historical, false);
});
for (const input of [null, undefined, [], "unexpected", {}, report({ kind: "unknown" }), report(confirmed(), { kind: "unknown" }), { ...report(confirmed()), retryAuthorization: "yes" }, report({ kind: "confirmed", persistence: { outcome: "uncertain" } })]) test(`unexpected input ${JSON.stringify(input)}`, () => {
  const result = presentPartnerReconciliation(input); assert.equal(result.state, "invalid-input"); assert.equal(result.retryAuthorization, "none");
  assert.deepEqual(result.actions, ["keep-writes-blocked", "technical-investigation"]);
});
test("throwing property access fails closed without exposing error", () => {
  const result = presentPartnerReconciliation({ get historical() { throw new Error("secret"); } });
  assert.equal(result.state, "invalid-input"); assert.doesNotMatch(JSON.stringify(result), /secret/);
});

function assertBlocked(input: unknown, expected = "invalid-input") {
  const result = presentPartnerReconciliation(input);
  assert.equal(result.state, expected); assert.equal(result.retryAuthorization, "none"); assert.equal(result.writes, "blocked"); assert.equal(result.storage, "preserve");
  assert.equal(result.historical.authenticatedProof, false); assert.equal(result.serverHistoricalEvidence, "unavailable");
  assert.ok(Object.isFrozen(result)); assert.ok(result.actions.includes("keep-writes-blocked"));
  assert.doesNotMatch(result.actions.join(" "), /retry|resubmit|upload|delete/);
  return result;
}
for (const invalidPartner of [{}, { ...partner, everAssociated: undefined }, { ...partner, id: "bad" },
  { ...partner, logo: {} }, { ...partner, logo: { ...partner.logo, originalFilename: undefined } },
  { ...partner, logo: { ...partner.logo, bucket: "other" } }, { ...partner, logoName: "different" },
  { ...partner, logo: null }, { ...partner, logo: undefined, logoName: "Impossible" }]) test(`malformed Partner ${JSON.stringify(invalidPartner)} cannot produce match or divergence`, () => {
  for (const kind of ["uploaded-reference-matches", "uploaded-reference-differs", "partner-found-history-unestablished"]) {
    const result = assertBlocked(report(confirmed(), { kind, partner: invalidPartner })); assert.equal(result.current.state, "invalid-input");
  }
});
for (const logo of [undefined, { ...partner.logo, originalFilename: null }]) test(`valid nullable logo ${JSON.stringify(logo)} remains accepted`, () => {
  const result = assertBlocked(report({ kind: "database-uncertain" }, { kind: "uploaded-reference-differs", partner: { ...partner, logo } }), "database-uncertain");
  assert.equal(result.current.state, "current-reference-differs");
});
for (const corrupt of [
  (h: Record<string, unknown>) => { delete (h.persistence as Record<string, unknown>).id; },
  (h: Record<string, unknown>) => { (h.persistence as Record<string, unknown>).id = "bad"; },
  (h: Record<string, unknown>) => { (h.persistence as Record<string, unknown>).id = admin; },
  (h: Record<string, unknown>) => { delete (h.persistence as Record<string, unknown>).cleanup; },
  (h: Record<string, unknown>) => { (h.persistence as Record<string, unknown>).refresh = { state: "completed" }; },
  (h: Record<string, unknown>) => { (h.persistence as Record<string, unknown>).refresh = { state: "failed" }; },
  (h: Record<string, unknown>) => { (h.persistence as Record<string, unknown>).operation = "delete"; },
  (h: Record<string, unknown>) => { delete h.reconciliation; },
]) test(`malformed confirmed history ${corrupt.toString()} cannot produce success`, () => {
  const input = report(confirmed()); corrupt(input.historical); const result = assertBlocked(input); assert.equal(result.historical.state, "invalid-input");
});
test("historical zero-row with current match is independent and noncontradictory", () => {
  const result = assertBlocked(report({ kind: "zero-row" }), "historical-zero-row");
  assert.equal(result.historical.state, "historical-zero-row"); assert.equal(result.current.state, "current-reference-matches");
  assert.match(result.message, /não afetou nenhuma linha/); assert.doesNotMatch(result.message, /A leitura não permitiu/);
  assert.match(result.current.message, /não comprova a gravação original/);
});
test("historical zero-row and current RLS inconclusive preserve both states", () => {
  const result = assertBlocked(report({ kind: "zero-row" }, { kind: "inconclusive", reason: "absent-or-invisible" }), "inconclusive");
  assert.equal(result.historical.state, "historical-zero-row"); assert.equal(result.current.state, "inconclusive");
});
test("inconsistent claimed match or divergence fails conservatively", () => {
  assertBlocked(report(confirmed(), { kind: "uploaded-reference-matches", partner: { ...partner, logo: undefined } }));
  assertBlocked(report(confirmed(), { kind: "uploaded-reference-differs", partner }));
  assertBlocked(report(confirmed(), { kind: "uploaded-reference-matches", partner: { ...partner, id: admin } }));
});
test("malformed uncertain discriminator and missing rejection error are rejected", () => {
  const input = report({ kind: "database-uncertain" }); Object.assign(input.historical, { mutation: { outcome: "confirmed", id, error: new MutationError("uncertain") } }); assertBlocked(input);
  const rejected = report({ kind: "database-rejected", error: { kind: "domain" } }); delete (rejected.historical as Record<string, unknown>).error; assertBlocked(rejected);
});
test("complete serialized legitimate results retain structural support without authentication", () => {
  for (const value of [report(confirmed()), report(confirmed("failed")), report({ kind: "database-uncertain" }), report({ kind: "upload-confirmed-database-rejected", error: { kind: "domain" } })]) {
    const result = presentPartnerReconciliation(JSON.parse(JSON.stringify(value)));
    assert.notEqual(result.state, "invalid-input"); assert.equal(result.historical.authenticatedProof, false); assert.equal(result.retryAuthorization, "none");
  }
});
