import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createRequestAuthAdapters } from "../server/partner-logo-verification/requestAuthAdapters.ts";
const id = "aaaaaaaa-0000-0000-0000-000000000001";
const sessionId = "bbbbbbbb-0000-0000-0000-000000000002";
const issuer = "https://test.invalid/auth/v1";
function fixture(requestToken = "private-token", userId = id) {
  let claims: unknown = { sub: userId, session_id: sessionId, iss: issuer, aud: "authenticated", exp: 2000 };
  let claimsError: unknown = null; let userError: unknown = null; let user: unknown = { id: userId }; let member: unknown = { user_id: userId };
  let memberCode: string | undefined; let status = 200; let network = false; let time = 1000; let userHook = () => {};
  const calls: string[] = []; const tokens: string[] = []; const queries: URL[] = [];
  const adapters = createRequestAuthAdapters(requestToken, { expectedIssuer: issuer, expectedAudience: "authenticated", now: () => time * 1000,
    auth: { getClaims: async (token, options) => { calls.push("claims"); tokens.push(token); assert.equal(options.allowExpired, false); return { data: claimsError ? null : { claims }, error: claimsError }; },
      getUser: async token => { calls.push("user"); tokens.push(token); userHook(); return { data: { user: userError ? null : user }, error: userError }; } },
    createMembershipClient: token => {
      calls.push("client"); tokens.push(token);
      return createClient("https://test.invalid", "test-publishable", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async input => {
        queries.push(new URL(String(input))); if (network) throw new Error("private"); return new Response(JSON.stringify(memberCode ? { code: memberCode } : member), { status, headers: { "content-type": "application/json" } });
      } } });
    },
  });
  return { adapters, calls, tokens, queries, claims: (v: unknown) => { claims = v; }, claimError: (v: unknown) => { claimsError = v; }, userError: (v: unknown) => { userError = v; }, user: (v: unknown) => { user = v; }, member: (v: unknown) => { member = v; }, fail: (code: string, s: number) => { memberCode = code; status = s; }, network: () => { network = true; }, expireDuringUser: () => { userHook = () => { time = 2000; }; } };
}
test("verified claims, Auth user and repeated self-membership use same request token", async () => {
  const f = fixture(); const auth = await f.adapters.authenticate("private-token"); assert.equal(auth.kind, "verified"); if (auth.kind !== "verified") return;
  assert.equal(await f.adapters.membership({ ...auth.identity }), "admin"); assert.equal(await f.adapters.membership(auth.identity), "admin");
  assert.deepEqual(f.calls, ["claims", "user", "client"]); assert.ok(f.tokens.every(t => t === "private-token")); assert.equal(f.queries.length, 2);
  assert.ok(f.queries.every(q => q.pathname.endsWith("cms_admins") && q.searchParams.get("select") === "user_id" && q.searchParams.get("user_id") === `eq.${id}`));
});
for (const token of ["", "different", "private-token "]) test(`request token mismatch ${token} issues no calls`, async () => { const f = fixture(); assert.equal((await f.adapters.authenticate(token)).kind, "denied"); assert.equal(f.calls.length, 0); });
for (const claims of [null, {}, { sub: id, session_id: "bad", iss: issuer, aud: "authenticated", exp: 2000 }, { sub: id, session_id: sessionId, iss: issuer, aud: "authenticated", exp: "2000" }]) test(`malformed claims ${JSON.stringify(claims)}`, async () => { const f = fixture(); f.claims(claims); assert.equal((await f.adapters.authenticate("private-token")).kind, "unavailable"); assert.deepEqual(f.calls, ["claims"]); });
for (const patch of [{ iss: "https://other.invalid" }, { aud: "other" }, { exp: 0 }]) test(`claim rejection ${JSON.stringify(patch)}`, async () => { const f = fixture(); f.claims({ sub: id, session_id: sessionId, iss: issuer, aud: "authenticated", exp: 2000, ...patch }); assert.equal((await f.adapters.authenticate("private-token")).kind, "denied"); assert.deepEqual(f.calls, ["claims"]); });
for (const error of [{ status: 401 }, { code: "bad_jwt" }, { name: "AuthInvalidJwtError" }, { status: 503 }, { status: 400 }]) test(`Auth error ${JSON.stringify(error)}`, async () => { const f = fixture(); f.claimError(error); assert.equal((await f.adapters.authenticate("private-token")).kind, "status" in error && error.status !== 401 ? "unavailable" : "denied"); });
test("Auth user must match claims", async () => { const f = fixture(); f.user({ id: sessionId }); assert.equal((await f.adapters.authenticate("private-token")).kind, "denied"); });
test("expiry during Auth request is denied", async () => { const f = fixture(); f.expireDuringUser(); assert.equal((await f.adapters.authenticate("private-token")).kind, "denied"); });
test("membership absent or malformed does not elevate", async () => { for (const member of [null, {}, { user_id: sessionId }]) { const f = fixture(); const a = await f.adapters.authenticate("private-token"); if (a.kind !== "verified") throw new Error("fixture"); f.member(member); assert.equal(await f.adapters.membership(a.identity), member && !('user_id' in member) ? "unavailable" : "denied"); } });
test("revoked membership after initial success is denied", async () => { const f = fixture(); const a = await f.adapters.authenticate("private-token"); if (a.kind !== "verified") return; assert.equal(await f.adapters.membership(a.identity), "admin"); f.member(null); assert.equal(await f.adapters.membership(a.identity), "denied"); });
for (const [code, status, expected] of [["42501", 403, "denied"], ["XX000", 503, "unavailable"]] as const) test(`membership ${code}`, async () => { const f = fixture(); const a = await f.adapters.authenticate("private-token"); if (a.kind !== "verified") return; f.fail(code, status); assert.equal(await f.adapters.membership(a.identity), expected); });
test("membership transport failure is unavailable, one query", async () => { const f = fixture(); const a = await f.adapters.authenticate("private-token"); if (a.kind !== "verified") return; f.network(); assert.equal(await f.adapters.membership(a.identity), "unavailable"); assert.equal(f.queries.length, 1); });
test("unverified or changed identity cannot query membership", async () => { const f = fixture(); assert.equal(await f.adapters.membership({ userId: id, sessionId, expiresAt: 2000 }), "denied"); const a = await f.adapters.authenticate("private-token"); if (a.kind !== "verified") return; assert.equal(await f.adapters.membership({ ...a.identity, userId: sessionId }), "denied"); assert.equal(f.queries.length, 0); });

for (const [error, expected] of [[{ status: 401 }, "denied"], [{ status: 503 }, "unavailable"]] as const) test(`Auth user error ${error.status}`, async () => { const f = fixture(); f.userError(error); assert.equal((await f.adapters.authenticate("private-token")).kind, expected); });
for (const user of [null, {}, { id: "bad" }]) test(`malformed Auth user ${JSON.stringify(user)}`, async () => { const f = fixture(); f.user(user); assert.equal((await f.adapters.authenticate("private-token")).kind, "unavailable"); });
test("request-scoped clients preserve independent tokens across concurrent requests", async () => {
  const a = fixture("token-a"); const b = fixture("token-b"); const [aa, bb] = await Promise.all([a.adapters.authenticate("token-a"), b.adapters.authenticate("token-b")]);
  if (aa.kind !== "verified" || bb.kind !== "verified") throw new Error("fixtures");
  await Promise.all([a.adapters.membership(aa.identity), b.adapters.membership(bb.identity)]);
  assert.ok(a.tokens.every(t => t === "token-a")); assert.ok(b.tokens.every(t => t === "token-b")); assert.equal(a.queries.length, 1); assert.equal(b.queries.length, 1);
});
test("audience array is supported without assuming signing mode", async () => { const f = fixture(); f.claims({ sub: id, session_id: sessionId, iss: issuer, aud: ["authenticated", "other"], exp: 2000 }); assert.equal((await f.adapters.authenticate("private-token")).kind, "verified"); });
test("failed reauthentication clears previous membership authorization", async () => { const f = fixture(); const a = await f.adapters.authenticate("private-token"); if (a.kind !== "verified") throw new Error("fixture"); f.claimError({ status: 503 }); assert.equal((await f.adapters.authenticate("private-token")).kind, "unavailable"); assert.equal(await f.adapters.membership(a.identity), "denied"); assert.equal(f.queries.length, 0); });

for (const [envelope, expected] of [
  [{ status: 200, data: { user_id: id } }, "unavailable"],
  [{ status: 200, data: { user_id: id }, error: null }, "admin"],
  [{ status: 200, data: { user_id: id }, error: { code: "42501" } }, "unavailable"],
  [{ status: 403, data: { user_id: id }, error: { code: "42501" } }, "unavailable"],
  [{ status: 200, data: null, error: null }, "denied"],
  [{ status: 503, data: null, error: { code: "XX000" } }, "unavailable"],
  [{ status: 200, data: {}, error: null }, "unavailable"],
  [{ status: 200, data: { user_id: "bad" }, error: null }, "unavailable"],
  [{ status: 200, data: { user_id: id, extra: true }, error: null }, "unavailable"],
  [{ status: 200, data: { user_id: sessionId }, error: null }, "denied"],
  [{ status: 201, data: { user_id: id }, error: null }, "unavailable"],
  [{ status: 204, data: null, error: null }, "unavailable"],
  [{ status: "200", data: { user_id: id }, error: null }, "unavailable"],
  [{ status: 200, error: null }, "unavailable"],
  [{ status: 200, data: { user_id: id }, error: false }, "unavailable"],
  [null, "unavailable"],
] as const) test(`membership envelope ${JSON.stringify(envelope)}`, async () => {
  let queries = 0;
  const client = { from: (table: string) => { assert.equal(table, "cms_admins"); return {
    select: (column: string) => { assert.equal(column, "user_id"); return { eq: (column: string, value: string) => {
      assert.equal(column, "user_id"); assert.equal(value, id); return { retry: (enabled: boolean) => {
        assert.equal(enabled, false); return { maybeSingle: async () => { queries++; return envelope; } };
      } };
    } }; },
  }; } } as unknown as Pick<ReturnType<typeof createClient>, "from">;
  const adapters = createRequestAuthAdapters("request-token", { expectedIssuer: issuer, expectedAudience: "authenticated", now: () => 1000000,
    auth: { getClaims: async () => ({ data: { claims: { sub: id, session_id: sessionId, iss: issuer, aud: "authenticated", exp: 2000 } }, error: null }), getUser: async () => ({ data: { user: { id } }, error: null }) },
    createMembershipClient: token => { assert.equal(token, "request-token"); return client; },
  });
  const auth = await adapters.authenticate("request-token"); if (auth.kind !== "verified") throw new Error("fixture");
  assert.equal(await adapters.membership(auth.identity), expected); assert.equal(queries, 1);
});
test("distinct concurrent administrators cannot share membership identity or request tokens", async () => {
  const a = fixture("token-a", id); const b = fixture("token-b", sessionId);
  const [aa, bb] = await Promise.all([a.adapters.authenticate("token-a"), b.adapters.authenticate("token-b")]);
  if (aa.kind !== "verified" || bb.kind !== "verified") throw new Error("fixtures");
  assert.notEqual(aa.identity.userId, bb.identity.userId);
  assert.deepEqual(await Promise.all([a.adapters.membership(aa.identity), b.adapters.membership(bb.identity)]), ["admin", "admin"]);
  assert.deepEqual(await Promise.all([a.adapters.membership(bb.identity), b.adapters.membership(aa.identity)]), ["denied", "denied"]);
  assert.ok(a.tokens.every(t => t === "token-a")); assert.ok(b.tokens.every(t => t === "token-b"));
  assert.equal(a.queries.length, 1); assert.equal(b.queries.length, 1);
  assert.equal(a.queries[0].searchParams.get("user_id"), `eq.${id}`); assert.equal(b.queries[0].searchParams.get("user_id"), `eq.${sessionId}`);
});
