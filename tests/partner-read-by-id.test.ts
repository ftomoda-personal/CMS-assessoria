import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createPartnersReadRepository } from "../src/features/partners/supabaseReadRepository.ts";
import { createSessionContinuityGuard } from "../src/lib/supabase/mutation.ts";
import type { ReadClient } from "../src/lib/supabase/readDataset";
const id = "aaaaaaaa-0000-0000-0000-000000000001";
const admin = "bbbbbbbb-0000-0000-0000-000000000002";
const row = { id, name: "Brand", website: "brand.example", logo_path: "legacy.png", logo_name: "Original", ever_associated: true };
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
for (const invalid of ["", "bad", `${id}\n`, "../partners", null]) test(`invalid UUID ${JSON.stringify(invalid)} issues no queries`, async () => {
  const f = fixture(); assert.equal((await f.repo.readById(invalid as string)).kind, "invalid-id"); assert.equal(f.requests.length, 0);
});
test("found Partner uses exact UUID filter and typed mapping without URL resolution", async () => {
  const f = fixture(); const result = await f.repo.readById(id.toUpperCase());
  assert.equal(result.kind, "found"); if (result.kind === "found") { assert.equal(result.partner.logo?.objectPath, "legacy.png"); assert.equal(result.partner.everAssociated, true); assert.equal(result.partner.logoUrl, undefined); }
  assert.equal(f.requests.length, 3); assert.equal(f.requests[1].url.searchParams.get("id"), `eq.${id.toUpperCase()}`);
  assert.ok(f.requests.every(r => r.method === "GET"));
});
for (const denied of ["deny", "logout"] as const) test(`${denied} prevents Partner query`, async () => {
  const f = fixture(); f[denied](); assert.equal((await f.repo.readById(id)).kind, "authorization-denied"); assert.equal(f.requests.some(r => r.url.pathname.endsWith("partners")), false);
});
test("unverified session identity fails closed", async () => {
  const f = fixture(); f.badClaims(); assert.equal((await f.repo.readById(id)).kind, "session-interrupted"); assert.equal(f.requests.length, 0);
});
for (const stage of ["partner", "membership"] as const) test(`refresh during ${stage} preserves session`, async () => {
  const f = fixture(); if (stage === "partner") f.hook(f.refresh); else f.memberHook(f.refresh);
  assert.equal((await f.repo.readById(id)).kind, "found");
});
for (const change of ["login", "otherAdmin", "logout"] as const) test(`${change} during query discards row`, async () => {
  const f = fixture(); f.hook(f[change]); assert.equal((await f.repo.readById(id)).kind, "session-interrupted");
});
test("new login during membership prevents Partner dispatch", async () => {
  const f = fixture(); f.memberHook(f.login); assert.equal((await f.repo.readById(id)).kind, "session-interrupted"); assert.equal(f.requests.length, 1);
});
test("caller guard survives refresh and rejects a new login", async () => {
  const f = fixture(); const guard = await createSessionContinuityGuard(f.client); f.refresh();
  assert.equal((await f.repo.readById(id, { sessionGuard: guard })).kind, "found"); f.login();
  assert.equal((await f.repo.readById(id, { sessionGuard: guard })).kind, "session-interrupted");
});
test("guard from another client is rejected before queries", async () => {
  const a = fixture(); const b = fixture(); const guard = await createSessionContinuityGuard(a.client);
  assert.equal((await b.repo.readById(id, { sessionGuard: guard })).kind, "session-interrupted"); assert.equal(b.requests.length, 0);
});
test("RLS-empty remains inconclusive, never not-found", async () => {
  const f = fixture(); f.data(null); assert.deepEqual(await f.repo.readById(id), { kind: "inconclusive", reason: "absent-or-invisible" }); assert.equal(f.requests.length, 3);
});
for (const empty of [false, true]) test(`membership revoked during query empty=${empty} is authorization denied`, async () => {
  const f = fixture(); if (empty) f.data(null); f.hook(f.deny);
  assert.equal((await f.repo.readById(id)).kind, "authorization-denied");
});
for (const [code, status, kind] of [["42501", 403, "authorization-denied"], ["XX000", 503, "failure"], ["PGRST116", 406, "failure"]] as const) test(`query ${status} ${code}`, async () => {
  const f = fixture(); f.fail(code, status); assert.equal((await f.repo.readById(id)).kind, kind);
  assert.equal(f.requests.filter(r => r.url.pathname.endsWith("partners")).length, 1);
});
for (const stage of ["network", "memberNetwork"] as const) test(`${stage} yields service failure without retry or raw details`, async () => {
  const f = fixture(); f[stage](); const result = await f.repo.readById(id);
  assert.deepEqual(result, { kind: "failure", reason: "service" }); assert.doesNotMatch(JSON.stringify(result), /private/);
});
for (const timing of ["before", "membership", "partner"] as const) test(`cancel ${timing}`, async () => {
  const f = fixture(); const controller = new AbortController();
  if (timing === "before") controller.abort(); else if (timing === "membership") f.memberHook(() => controller.abort()); else f.hook(() => controller.abort());
  assert.equal((await f.repo.readById(id, { signal: controller.signal })).kind, "cancelled");
  assert.equal(f.requests.length, timing === "before" ? 0 : timing === "membership" ? 1 : 2);
});
for (const data of [{ ...row, id: admin }, { ...row, name: 1 }, { ...row, logo_path: null }, { ...row, id: "invalid" }]) test(`invalid response ${JSON.stringify(data)}`, async () => {
  const f = fixture(); f.data(data); assert.equal((await f.repo.readById(id)).kind, "failure");
});
test("readAll mapping and behavior remain compatible", async () => {
  const f = fixture(); const values = await f.repo.readAll(); assert.equal(values.length, 1); assert.equal(values[0].id, id); assert.equal(f.requests.length, 4);
});

test("missing claims verifier rejects before remote queries", async () => {
  const f = fixture(); f.client.auth.getClaims = undefined;
  assert.equal((await f.repo.readById(id)).kind, "session-interrupted"); assert.equal(f.requests.length, 0);
});
test("late network failure from a new login is session interruption", async () => {
  const f = fixture(); f.hook(f.login); f.network();
  assert.equal((await f.repo.readById(id)).kind, "session-interrupted");
});
test("late cancelled network failure remains cancellation", async () => {
  const f = fixture(); const controller = new AbortController(); f.hook(() => controller.abort()); f.network();
  assert.equal((await f.repo.readById(id, { signal: controller.signal })).kind, "cancelled");
});
