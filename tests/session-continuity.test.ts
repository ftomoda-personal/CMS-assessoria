import type { ReadClient } from "../src/lib/supabase/readDataset.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { assertSessionContinuity, createSessionContinuityGuard, createMutationLifecycle, MutationError, parsePersistedUuid } from "../src/lib/supabase/mutation.ts";
import { prepareLogoUpload, assertPreparedLogoSession, createLogoReconciliationDescriptor } from "../src/features/partners/logoIntegrationContracts.ts";
import { createPartnerLogoRepository } from "../src/features/partners/supabaseLogoRepository.ts";
import { createPartnersWriteRepository } from "../src/features/partners/supabaseWriteRepository.ts";
import type { LogoClient } from "../src/features/partners/supabaseLogoRepository.ts";

const id = parsePersistedUuid("aaaaaaaa-0000-0000-0000-000000000001");
const empty = { logo_path: null, logo_name: null };
const context = { operationId: "bbbbbbbb-0000-0000-0000-000000000002", initiatingAdminId: id, target: { kind: "edit" as const, id, expectedLogo: empty } };
const file = new File([new Uint8Array([137,80,78,71,13,10,26,10])], "test.png", { type: "image/png" });
const fails = (kind: string) => (error: unknown) => error instanceof MutationError && error.kind === kind;
function fixture() {
  let refreshToken = "private-refresh"; let token = "private-token"; let userId: string = id; let loggedIn = true; let network = false; let rejection = false;
  let claimsFault: string | undefined; let duringClaims: (() => void) | undefined;
  let sessionCalls = 0; let changeAt = Infinity;
  let duringMembership: (() => void) | undefined; let duringWrite: (() => void) | undefined;
  const requests: { method: string; path: string }[] = [];
  const sdk = createClient("https://test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const path = new URL(String(input)).pathname; const method = init?.method ?? "GET"; requests.push({ method, path });
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
      if (path.endsWith("cms_admins")) { duringMembership?.(); return json({ user_id: userId }); }
      if (method === "GET") return json({ id, name: "Brand", website: "brand.example", logo_path: "logos/aaaaaaaa-0000-0000-0000-000000000001.png", logo_name: "test.png", ever_associated: false });
      duringWrite?.();
      if (network) throw new Error("private-token");
      if (rejection) return json({ code: "42501", message: "private-token" }, 403);
      if (path.includes("/storage/")) return json({ Id: id, Key: path.slice("/storage/v1/object/".length) });
      return json([{ id }]);
    } },
  });
  const client: LogoClient = { from: sdk.from.bind(sdk), storage: sdk.storage, auth: { getClaims: (async (jwt: string) => {
    const sub = claimsFault === "user" ? "dddddddd-0000-0000-0000-000000000001" : userId;
    const session_id = claimsFault === "missing" ? undefined : claimsFault === "malformed" ? "bad" : jwt.includes("replacement") ? "eeeeeeee-0000-0000-0000-000000000001" : "ffffffff-0000-0000-0000-000000000001";
    duringClaims?.();
    if (claimsFault === "throw") throw new Error("private-token");
    return { data: claimsFault === "unverified" ? null : { claims: { sub, session_id } }, error: claimsFault === "error" ? { message: "private-token" } : null };
  }) as NonNullable<ReadClient["auth"]["getClaims"]>, getSession: (async () => {
    if (++sessionCalls === changeAt) token = "replacement-token";
    return { data: { session: loggedIn ? { user: { id: userId }, access_token: token, refresh_token: refreshToken } : null }, error: null };
  }) as LogoClient["auth"]["getSession"] } };
  return { client, logo: createPartnerLogoRepository(client, { randomUUID: () => id }), partners: createPartnersWriteRepository(client), requests,
    claimsFault: (fault: string) => { claimsFault = fault; }, duringClaims: (fn: () => void) => { duringClaims = fn; }, refresh: () => { token = "refreshed-token"; refreshToken = "rotated-refresh"; },
    writes: () => requests.filter(r => r.method !== "GET"), replace: () => { token = "replacement-token"; }, otherAdmin: () => { userId = "cccccccc-0000-0000-0000-000000000003"; }, logout: () => { loggedIn = false; },
    membership: (fn: () => void) => { duringMembership = fn; }, write: (fn: () => void) => { duringWrite = fn; }, loseResponse: () => { network = true; }, reject: () => { rejection = true; }, nextSessionChange: () => { changeAt = sessionCalls + 1; } };
}

test("same guard spans upload, prepared metadata and conditional DB persistence", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client);
  const upload = await f.logo.upload(file, { sessionGuard: guard }); assert.equal(upload.outcome, "confirmed");
  if (upload.outcome !== "confirmed") return;
  const prepared = prepareLogoUpload(context, upload, guard);
  const result = await f.partners.setLogo(id, empty, prepared, { sessionGuard: guard });
  assert.equal(result.outcome, "confirmed"); assert.equal(f.writes().length, 2);
});

for (const change of ["replace", "otherAdmin", "logout"] as const) test(`${change} invalidates shared guard before upload`, async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client); f[change]();
  await assert.rejects(f.logo.upload(file, { sessionGuard: guard }), fails(change === "logout" ? "authorization" : "stale")); assert.equal(f.writes().length, 0);
});

test("session replacement after upload acknowledgment prevents DB association", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client); const upload = await f.logo.upload(file, { sessionGuard: guard });
  assert.equal(upload.outcome, "confirmed"); if (upload.outcome !== "confirmed") return;
  const prepared = prepareLogoUpload(context, upload, guard); f.replace();
  await assert.rejects(f.partners.setLogo(id, empty, prepared, { sessionGuard: guard }), fails("stale")); assert.equal(f.writes().length, 1);
});

test("session replacement during asynchronous membership preflight prevents DB dispatch", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client); f.membership(f.replace);
  await assert.rejects(f.partners.removeLogo(id, empty, { sessionGuard: guard }), fails("stale")); assert.equal(f.writes().length, 0);
});

test("final lifecycle check catches change after completed preflight", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client); const life = await createMutationLifecycle(f.client, { sessionGuard: guard });
  await life.prepareDispatch(); f.nextSessionChange();
  await assert.rejects(life.verifyBeforeDispatch(), fails("stale")); assert.throws(() => life.markDispatched(), fails("response")); assert.equal(f.writes().length, 0);
});

test("abort before final dispatch remains cancellation", async () => {
  const f = fixture(); const controller = new AbortController(); const guard = await createSessionContinuityGuard(f.client);
  const life = await createMutationLifecycle(f.client, { sessionGuard: guard, signal: controller.signal });
  await life.prepareDispatch(); controller.abort(); await assert.rejects(life.verifyBeforeDispatch(), fails("cancelled")); assert.equal(f.writes().length, 0);
});

test("change after dispatched confirmed upload suppresses applicability", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client); f.write(f.replace);
  const result = await f.logo.upload(file, { sessionGuard: guard }); assert.equal(result.outcome, "confirmed");
  if (result.outcome === "confirmed") assert.equal(result.canApply, false);
});

test("change and lost response after dispatch remain uncertain without retry", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client); f.write(f.replace); f.loseResponse();
  const result = await f.partners.removeLogo(id, empty, { sessionGuard: guard }); assert.equal(result.outcome, "uncertain"); assert.equal(f.writes().length, 1);
});

test("definitive server rejection remains definitive despite session replacement", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client); f.write(f.replace); f.reject();
  await assert.rejects(f.partners.removeLogo(id, empty, { sessionGuard: guard }), fails("authorization")); assert.equal(f.writes().length, 1);
});

test("prepared retry requires original live binding; clones and another guard cannot authorize", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client); const upload = await f.logo.upload(file, { sessionGuard: guard });
  if (upload.outcome !== "confirmed") return assert.fail();
  const prepared = prepareLogoUpload(context, upload, guard);
  await assertPreparedLogoSession(prepared, guard, f.client);
  await assert.rejects(assertPreparedLogoSession(prepared, await createSessionContinuityGuard(f.client), f.client), fails("stale"));
  await assert.rejects(assertPreparedLogoSession(JSON.parse(JSON.stringify(prepared)), guard, f.client), fails("stale"));
  await assert.rejects(f.partners.setLogo(id, empty, prepared), fails("stale"));
  assert.equal(f.writes().length, 1);
});

test("guard cannot serialize or leak credentials; descriptor remains serializable", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client);
  assert.deepEqual(Object.keys(guard), []); assert.throws(() => JSON.stringify(guard), fails("response"));
  const descriptor = createLogoReconciliationDescriptor({ context, intent: "keep" });
  assert.doesNotMatch(JSON.stringify(descriptor), /token|sessionGuard|private/);
  await assert.rejects(assertSessionContinuity({} as typeof guard, f.client), fails("stale"));
});

test("unguarded repositories remain compatible and cannot reach physical deletion", async () => {
  const f = fixture(); await f.logo.upload(file); await f.partners.update(id, { name: "Brand", website: "brand.example" });
  assert.equal(f.writes().length, 2); assert.equal(f.requests.some(r => r.method === "DELETE"), false);
});

for (const fault of ["missing", "malformed", "user", "unverified", "throw", "error"]) test(`rejects ${fault} claims without dispatch`, async () => {
  const f = fixture(); f.claimsFault(fault);
  await assert.rejects(f.logo.upload(file), fails("stale")); assert.equal(f.writes().length, 0);
});
test("session replacement during asynchronous claims verification fails closed", async () => {
  const f = fixture(); f.duringClaims(f.replace);
  await assert.rejects(createSessionContinuityGuard(f.client), fails("stale")); assert.equal(f.writes().length, 0);
});
test("refresh during verification cannot apply stale claims", async () => {
  const f = fixture(); f.duringClaims(f.refresh);
  await assert.rejects(createSessionContinuityGuard(f.client), fails("stale"));
});
test("refresh between upload and DB preserves prepared binding and refresh completion", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client);
  const upload = await f.logo.upload(file, { sessionGuard: guard });
  if (upload.outcome !== "confirmed") return assert.fail();
  const prepared = prepareLogoUpload(context, upload, guard); f.refresh();
  await assertPreparedLogoSession(prepared, guard, f.client);
  f.membership(f.refresh);
  const result = await f.partners.setLogo(id, empty, prepared, { sessionGuard: guard });
  assert.equal(result.outcome, "confirmed");
  if (result.outcome === "confirmed") assert.equal(result.refresh.state, "completed");
  assert.equal(f.writes().length, 2);
});
test("refresh after confirmed persistence remains applicable for unguarded callers", async () => {
  const f = fixture(); f.write(f.refresh);
  const result = await f.partners.update(id, { name: "Brand", website: "brand.example" });
  assert.equal(result.outcome, "confirmed");
  if (result.outcome === "confirmed") assert.equal(result.refresh.state, "completed");
});
test("confirmed mismatch permanently invalidates guard", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client); f.replace();
  await assert.rejects(assertSessionContinuity(guard, f.client), fails("stale")); f.refresh();
  await assert.rejects(assertSessionContinuity(guard, f.client), fails("stale"));
});

test("access and refresh token rotation preserves verified identity", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client);
  const before = (await f.client.auth.getSession()).data.session!;
  f.refresh(); const after = (await f.client.auth.getSession()).data.session!;
  assert.notEqual(before.access_token, after.access_token);
  assert.notEqual(before.refresh_token, after.refresh_token);
  await assertSessionContinuity(guard, f.client);
});
test("abort during asynchronous verification is cancellation before dispatch", async () => {
  const f = fixture(); const controller = new AbortController(); f.duringClaims(() => controller.abort());
  await assert.rejects(f.logo.upload(file, { signal: controller.signal }), fails("cancelled"));
  assert.equal(f.writes().length, 0);
});
