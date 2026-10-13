import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createPartnersReadRepository } from "../src/features/partners/supabaseReadRepository.ts";
import { createSessionContinuityGuard } from "../src/lib/supabase/mutation.ts";
import type { ReadClient } from "../src/lib/supabase/readDataset";
const id = "aaaaaaaa-0000-0000-0000-000000000001";
const admin = "bbbbbbbb-0000-0000-0000-000000000002";
const path = `logos/${id}.png`;
const row = { id, name: "Brand", website: "brand.example", logo_path: "legacy.png", logo_name: "Original", ever_associated: true };
import { createPartnerReconciliation } from "../src/features/partners/partnerReconciliation.ts";
import { createLogoReconciliationDescriptor } from "../src/features/partners/logoIntegrationContracts.ts";
import type { PartnerLogoIntegrationOutcome, LogoReconciliationDescriptor } from "../src/features/partners/logoIntegrationContracts";
import { MutationError, parsePersistedUuid } from "../src/lib/supabase/mutation.ts";
function history(overrides: Partial<LogoReconciliationDescriptor> = {}): PartnerLogoIntegrationOutcome {
  return { kind: "database-uncertain", objects: "preserve", mutation: { outcome: "uncertain", id: parsePersistedUuid(id), error: new MutationError("uncertain") },
    reconciliation: createLogoReconciliationDescriptor({ context: { operationId: id, initiatingAdminId: parsePersistedUuid(admin), target: { kind: "edit", id: parsePersistedUuid(id), expectedLogo: { logo_path: "old.png", logo_name: "Old" } } }, intent: "replace", uploaded: { state: "confirmed", metadata: { bucket: "partner-logos", objectPath: path, originalFilename: "New" } }, ...overrides }),
  };
}
function fixture() {
  let token = "initial"; let sessionId = id; let user = admin; let loggedIn = true; let member = true; let claims = true;
  let data: unknown = row; let code: string | undefined; let status = 200; let network = false; let memberNetwork = false;
  let hook = () => {}; let memberHook = () => {};
  const requests: { url: URL; method: string }[] = [];
  const sdk = createClient("https://test.invalid", "test-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, method: init?.method ?? "GET" });
    const respond = (value: unknown, responseStatus = 200, extra = {}) => new Response(JSON.stringify(value), { status: responseStatus, headers: { "content-type": "application/json", ...extra } });
    if (url.pathname.endsWith("cms_admins")) {
      memberHook(); if (memberNetwork) throw new Error("private-network-details");
      return respond(member ? { user_id: user } : null);
    }
    assert.equal(url.pathname, "/rest/v1/partners"); hook();
    if (network) throw new Error("private-network-details");
    if (code) return respond({ code, message: "private" }, status);
    if (!url.searchParams.has("limit") && url.searchParams.get("id")?.startsWith("eq.")) return respond(data);
    // readAll compatibility: SDK HEAD handling needs an empty body.
    if (init?.method === "HEAD") return new Response(null, { status: 200, headers: { "content-range": "0-0/1" } });
    return respond([row], 200, { "content-range": "0-0/1" });
  } } });
  const client: ReadClient = { from: sdk.from.bind(sdk), auth: {
    getSession: (async () => ({ data: { session: loggedIn ? { access_token: token, user: { id: user } } : null }, error: null })) as ReadClient["auth"]["getSession"],
    getClaims: (async () => ({ data: claims ? { claims: { sub: user, session_id: sessionId } } : null, error: null })) as NonNullable<ReadClient["auth"]["getClaims"]>,
  } };
  return { client, repo: createPartnersReadRepository(client), requests,
    data: (value: unknown) => { data = value; }, deny: () => { member = false; }, logout: () => { loggedIn = false; }, badClaims: () => { claims = false; },
    refresh: () => { token = "refreshed"; }, login: () => { token = "new-login"; sessionId = admin; }, otherAdmin: () => { user = id; token = "other-admin"; sessionId = admin; },
    hook: (fn: () => void) => { hook = fn; }, memberHook: (fn: () => void) => { memberHook = fn; },
    fail: (value: string, httpStatus: number) => { code = value; status = httpStatus; }, network: () => { network = true; }, memberNetwork: () => { memberNetwork = true; },
  };
}
for (const [logo_path, logo_name, expected] of [[path, "New", "uploaded-reference-matches"], ["other.png", "New", "uploaded-reference-differs"], [path, "Other", "uploaded-reference-differs"], [null, null, "uploaded-reference-differs"]] as const) test(`observed ${logo_path}/${logo_name}`, async () => {
  const f = fixture(); f.data({ ...row, logo_path, logo_name }); const historical = history();
  const result = await createPartnerReconciliation(f.repo).reconcile(historical);
  assert.equal(result.observation.kind, expected); assert.equal(result.historical, historical); assert.equal(result.historical.kind, "database-uncertain");
  assert.equal(result.retryAuthorization, "none"); assert.equal(result.objects, "preserve"); assert.ok(result.nextActions.includes("keep-writes-blocked"));
  assert.ok(f.requests.every(r => r.method === "GET" && ["/rest/v1/partners", "/rest/v1/cms_admins"].includes(r.url.pathname)));
});
for (const intent of ["keep", "remove"] as const) test(`${intent} observes row without inferring historical persistence`, async () => {
  const f = fixture(); const result = await createPartnerReconciliation(f.repo).reconcile(history({ intent, uploaded: undefined }));
  assert.equal(result.observation.kind, "partner-found-history-unestablished"); assert.equal(result.historical.kind, "database-uncertain");
});
test("unknown creation UUID requires durable correlation and performs no search", async () => {
  const f = fixture(); const historical = history({ context: { operationId: id, initiatingAdminId: parsePersistedUuid(admin), target: { kind: "create" } } });
  const result = await createPartnerReconciliation(f.repo).reconcile(historical);
  assert.deepEqual(result.observation, { kind: "unresolved", reason: "missing-partner-id", requires: "durable-correlation" }); assert.equal(f.requests.length, 0);
});
test("known creation UUID is read exactly", async () => {
  const f = fixture(); const result = await createPartnerReconciliation(f.repo).reconcile(history({ context: { operationId: id, initiatingAdminId: parsePersistedUuid(admin), target: { kind: "create" } }, persistedPartnerId: parsePersistedUuid(id) }));
  assert.equal(result.observation.kind, "uploaded-reference-differs"); assert.equal(f.requests[1].url.searchParams.get("id"), `eq.${id}`);
});
for (const invalid of ["bad", "z".repeat(36)]) test(`invalid UUID ${invalid} is unresolved without queries`, async () => {
  const f = fixture(); const historical = history(); Object.assign(historical.reconciliation.context.target, { id: invalid });
  const result = await createPartnerReconciliation(f.repo).reconcile(historical); assert.equal(result.observation.kind, "unresolved");
  if (result.observation.kind === "unresolved") assert.equal(result.observation.reason, "invalid-partner-id"); assert.equal(f.requests.length, 0);
});
test("invalid descriptor version fails closed", async () => {
  const f = fixture(); const historical = history(); Object.assign(historical.reconciliation, { version: 2 });
  assert.equal((await createPartnerReconciliation(f.repo).reconcile(historical)).observation.kind, "unresolved"); assert.equal(f.requests.length, 0);
});
for (const [control, expected] of [["deny", "authorization-denied"], ["logout", "authorization-denied"], ["network", "failure"]] as const) test(`read ${control}`, async () => {
  const f = fixture(); f[control](); const historical = history(); const result = await createPartnerReconciliation(f.repo).reconcile(historical);
  assert.equal(result.observation.kind, expected); assert.equal("partner" in result.observation, false); assert.equal(result.historical, historical);
});
test("RLS empty remains inconclusive", async () => {
  const f = fixture(); f.data(null); assert.equal((await createPartnerReconciliation(f.repo).reconcile(history())).observation.kind, "inconclusive");
});
for (const change of ["login", "refresh", "deny"] as const) test(`${change} while read pending`, async () => {
  const f = fixture(); f.hook(f[change]); const result = await createPartnerReconciliation(f.repo).reconcile(history());
  assert.equal(result.observation.kind, change === "login" ? "session-interrupted" : change === "deny" ? "authorization-denied" : "uploaded-reference-differs");
  if (change !== "refresh") assert.equal("partner" in result.observation, false);
});
for (const before of [true, false]) test(`cancel before=${before}`, async () => {
  const f = fixture(); const controller = new AbortController(); if (before) controller.abort(); else f.hook(() => controller.abort());
  assert.equal((await createPartnerReconciliation(f.repo).reconcile(history(), { signal: controller.signal })).observation.kind, "cancelled");
});
test("original caller guard is forwarded, supports refresh and rejects same-admin new login", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client); const service = createPartnerReconciliation(f.repo);
  f.refresh(); assert.equal((await service.reconcile(history(), { sessionGuard: guard })).observation.kind, "uploaded-reference-differs");
  f.login(); assert.equal((await service.reconcile(history(), { sessionGuard: guard })).observation.kind, "session-interrupted");
});
test("confirmed persistence with failed refresh stays confirmed even if observation differs", async () => {
  const f = fixture(); const historical: PartnerLogoIntegrationOutcome = { kind: "confirmed", objects: "preserve", reconciliation: history().reconciliation,
    persistence: { outcome: "confirmed", operation: "persist", id: parsePersistedUuid(id), refresh: { state: "failed", error: new MutationError("response") }, cleanup: { state: "not-needed" } } };
  const result = await createPartnerReconciliation(f.repo).reconcile(historical);
  assert.equal(result.observation.kind, "uploaded-reference-differs"); assert.equal(result.historical, historical); assert.equal(historical.persistence.refresh.state, "failed");
});
test("uncertain upload match does not promote upload or authorize writes", async () => {
  const f = fixture(); f.data({ ...row, logo_path: path, logo_name: "New" }); const base = history();
  const historical: PartnerLogoIntegrationOutcome = { kind: "upload-uncertain", objects: "preserve", reconciliation: { ...base.reconciliation, uploaded: { ...base.reconciliation.uploaded!, state: "uncertain" } }, upload: { ...base.reconciliation.uploaded!.metadata, outcome: "uncertain", error: new MutationError("uncertain") } };
  const result = await createPartnerReconciliation(f.repo).reconcile(historical); assert.equal(result.observation.kind, "uploaded-reference-matches");
  assert.equal(result.historical.kind, "upload-uncertain"); assert.equal(result.retryAuthorization, "none");
});
test("descriptor snapshot protects comparison from caller mutation while pending", async () => {
  const f = fixture(); f.data({ ...row, logo_path: path, logo_name: "New" }); const historical = history();
  f.hook(() => Object.assign(historical.reconciliation.uploaded!.metadata, { objectPath: "changed" }));
  assert.equal((await createPartnerReconciliation(f.repo).reconcile(historical)).observation.kind, "uploaded-reference-matches");
});
test("DI boundary exposes only reconcile; rejected dependency promise fails conservatively", async () => {
  const service = createPartnerReconciliation({ readById: async () => { throw new Error("private"); } });
  assert.deepEqual(Object.keys(service), ["reconcile"]); const result = await service.reconcile(history());
  assert.deepEqual(result.observation, { kind: "failure", reason: "service" }); assert.equal(result.retryAuthorization, "none");
});
