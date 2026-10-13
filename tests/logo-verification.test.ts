import assert from "node:assert/strict";
import { test } from "node:test";
import { createLogoVerificationHandler } from "../server/partner-logo-verification/handler.ts";
import type { VerificationHandlerDependencies } from "../server/partner-logo-verification/handler";
import { createStorageInfoAdapter } from "../server/partner-logo-verification/storageInfoAdapter.ts";
import { createSessionContinuityGuard } from "../src/lib/supabase/mutation.ts";
import { createGuardedLogoVerification } from "../src/features/partners/guardedLogoVerification.ts";
import { verificationInvariants, verificationResult, parseRemoteVerification } from "../src/features/partners/logoVerificationContracts.ts";
import type { LogoVerificationRequest } from "../src/features/partners/logoVerificationContracts";
import type { ReadClient } from "../src/lib/supabase/readDataset";
const id = "aaaaaaaa-0000-0000-0000-000000000001";
const path = `logos/${id}.png`; const input = { version: 1 as const, objectPath: path };
const identity = { userId: id, sessionId: id, expiresAt: 2000000000 };
const observed = { kind: "object-observed" as const, metadata: { sizeBytes: 8, contentType: "image/png" as const } };
function invariant(value: unknown) {
  const r = value as Record<string, unknown>; for (const [key, expected] of Object.entries(verificationInvariants)) assert.equal(r[key], expected);
  assert.doesNotMatch(JSON.stringify(value), /private-token|secret-error|eTag|owner/);
}
function server(overrides: Partial<VerificationHandlerDependencies> = {}) {
  const calls: string[] = [];
  const handler = createLogoVerificationHandler({
    now: () => 1000000000 * 1000,
    authenticate: async () => { calls.push("auth"); return { kind: "verified", identity }; },
    membership: async () => { calls.push("member"); return "admin"; },
    acquire: async () => { calls.push("acquire"); return { kind: "allowed", release: async () => { calls.push("release"); } }; },
    inspect: async p => { calls.push("info"); assert.equal(p, path); return observed; }, ...overrides,
  });
  return { calls, run: async (body: unknown = input, token = "private-token") => {
    const response = await handler(new Request("https://endpoint.invalid", { method: "POST", headers: { "content-type": "application/json", authorization: token ? `Bearer ${token}` : "" }, body: JSON.stringify(body) }));
    assert.equal(response.headers.get("cache-control"), "no-store"); const result = await response.json(); invariant(result); return { result, status: response.status };
  } };
}
test("server sequencing, exact-path inspection, post authorization and lease release", async () => {
  const f = server(); assert.equal((await f.run()).result.kind, "object-observed"); assert.deepEqual(f.calls, ["auth", "member", "acquire", "info", "auth", "member", "release"]);
});
for (const objectPath of [path, `logos/${id}.jpg`]) test(`canonical ${objectPath}`, async () => {
  const f = server({ inspect: async p => { assert.equal(p, objectPath); return observed; } }); assert.equal((await f.run({ version: 1, objectPath })).result.kind, "object-observed");
});
for (const body of [{ ...input, bucket: "partner-logos" }, { ...input, version: 2 }, {}, { ...input, objectPath: `logos/${id.toUpperCase()}.png` }, { ...input, objectPath: `${path}\n` }, { ...input, objectPath: "https://example.com/a.png" }, { ...input, objectPath: "logos/*" }, { ...input, objectPath: "../logos/a.png" }, { ...input, objectPath: "logos/" }]) test(`invalid request ${JSON.stringify(body)}`, async () => {
  const f = server(); assert.equal((await f.run(body)).result.kind, "invalid-request"); assert.equal(f.calls.length, 0);
});
for (const auth of [{ kind: "denied" as const }, { kind: "verified" as const, identity: { ...identity, expiresAt: 0 } }, { kind: "verified" as const, identity: { ...identity, sessionId: "bad" } }]) test(`invalid or expired auth ${JSON.stringify(auth)}`, async () => {
  const f = server({ authenticate: async () => auth }); assert.equal((await f.run()).result.kind, auth.kind === "verified" && auth.identity.sessionId === "bad" ? "service-failure" : "authorization-denied"); assert.equal(f.calls.includes("info"), false);
});
test("missing bearer prevents verification", async () => { const f = server(); assert.equal((await f.run(input, "")).result.kind, "authorization-denied"); assert.equal(f.calls.length, 0); });
for (const member of ["denied", "unavailable"] as const) test(`membership ${member}`, async () => {
  const f = server({ membership: async () => member }); assert.equal((await f.run()).result.kind, member === "denied" ? "authorization-denied" : "service-failure"); assert.equal(f.calls.includes("info"), false);
});
test("revoked post-read membership discards fetched metadata", async () => {
  let count = 0; const f = server({ membership: async () => ++count === 1 ? "admin" : "denied" }); const { result } = await f.run(); assert.equal(result.kind, "authorization-denied"); assert.equal("metadata" in result, false); assert.ok(f.calls.includes("release"));
});
for (const denial of ["rate-limited", "concurrency-limited", "unavailable"] as const) test(`abuse decision ${denial} prevents Storage`, async () => {
  const f = server({ acquire: async () => ({ kind: denial }) }); const { result } = await f.run(); assert.equal(result.kind, "service-failure"); assert.equal(f.calls.includes("info"), false);
});
test("limiter exception fails closed", async () => { const f = server({ acquire: async () => { throw new Error("secret-error"); } }); assert.equal((await f.run()).result.reason, "abuse-control-unavailable"); assert.equal(f.calls.includes("info"), false); });
test("concurrent request rejected while injected lease is occupied", async () => {
  let occupied = false; let resume: (() => void) | undefined; let entered: (() => void) | undefined;
  const started = new Promise<void>(r => { entered = r; }); const pending = new Promise<void>(r => { resume = r; });
  const f = server({ acquire: async () => occupied ? { kind: "concurrency-limited" } : (occupied = true, { kind: "allowed", release: async () => { occupied = false; } }), inspect: async () => { entered!(); await pending; return observed; } });
  const first = f.run(); await started; assert.equal((await f.run()).result.reason, "concurrency-limited"); resume!(); assert.equal((await first).result.kind, "object-observed"); assert.equal(occupied, false);
});
function adapter(response: unknown, recognizeNotFound?: (e: { status: number; code?: string }) => boolean) {
  const calls: string[] = [];
  const a = createStorageInfoAdapter({ storage: { from: bucket => { assert.equal(bucket, "partner-logos"); return { info: async p => { calls.push(p); return response; } }; } } }, { recognizeNotFound });
  return { calls, inspect: () => a.inspect(path) };
}
test("info normalization exposes only approved fields; no ETag digest or owner", async () => {
  const f = adapter({ error: null, data: { bucketId: "partner-logos", name: path, size: 8, contentType: "image/png", createdAt: "2026-10-13T12:00:00Z", lastModified: "2026-10-13T12:01:00Z", etag: "private", owner: "private" } });
  const result = await f.inspect(); assert.deepEqual(result, { kind: "object-observed", metadata: { sizeBytes: 8, contentType: "image/png", createdAt: "2026-10-13T12:00:00Z", lastModifiedAt: "2026-10-13T12:01:00Z" } }); invariant(verificationResult(result)); assert.deepEqual(f.calls, [path]);
});
for (const data of [null, { bucketId: "other" }, { name: "other" }, { size: -1 }, { size: "8" }, { contentType: null }, { contentType: "image/svg+xml" }, { createdAt: "bad" }, { lastModified: undefined }]) test(`malformed info ${JSON.stringify(data)}`, async () => { assert.equal((await adapter({ error: null, data }).inspect()).kind, "invalid-response"); });
for (const status of [401, 403, 500, 0]) test(`Storage error ${status}`, async () => {
  const result = await adapter({ data: null, error: { status, message: "secret-error" } }).inspect(); assert.deepEqual(result, { kind: "service-failure", reason: status === 401 || status === 403 ? "verification-access" : "unavailable" });
});
test("unknown not-found remains inconclusive by default", async () => { assert.equal((await adapter({ data: null, error: { status: 404, code: "test-missing" } }).inspect()).kind, "inconclusive"); });
test("injected recognized signature is negative observation with in-flight caveat", async () => {
  const result = await adapter({ data: null, error: { status: 404, code: "fixture-missing" } }, e => e.status === 404 && e.code === "fixture-missing").inspect(); assert.deepEqual(result, { kind: "object-not-observed", reason: "storage-reported-not-found", earlierUploadMayStillBeInFlight: true });
});
function browser() {
  let token = "private-token"; let sessionId = id; let hook = () => {}; let fail = false; let calls = 0;
  const auth = { getSession: async () => ({ data: { session: { access_token: token, user: { id } } }, error: null }), getClaims: async () => ({ data: { claims: { sub: id, session_id: sessionId } }, error: null }) } as unknown as ReadClient["auth"];
  const service = createGuardedLogoVerification({ auth } as ReadClient, { request: async r => { calls++; assert.deepEqual(r, input); hook(); if (fail) throw new Error("secret-error"); return verificationResult(observed); } });
  return { client: { auth } as ReadClient, service, calls: () => calls, hook: (fn: () => void) => { hook = fn; }, refresh: () => { token = "refreshed-token"; }, login: () => { token = "new-login"; sessionId = "bbbbbbbb-0000-0000-0000-000000000002"; }, fail: () => { fail = true; } };
}
for (const change of ["refresh", "login"] as const) test(`browser ${change} during request`, async () => { const f = browser(); f.hook(f[change]); const result = await f.service.verify(input); invariant(result); assert.equal(result.kind, change === "refresh" ? "object-observed" : "session-interrupted"); if (change === "login") assert.equal("metadata" in result, false); assert.equal(f.calls(), 1); });
for (const before of [true, false]) test(`browser cancellation before=${before}`, async () => { const f = browser(); const c = new AbortController(); if (before) c.abort(); else f.hook(() => c.abort()); const result = await f.service.verify(input, { signal: c.signal }); invariant(result); assert.equal(result.kind, "cancelled"); assert.equal(f.calls(), before ? 0 : 1); });
test("browser network failure is service failure, no retry", async () => { const f = browser(); f.fail(); const result = await f.service.verify(input); invariant(result); assert.equal(result.kind, "service-failure"); assert.equal(f.calls(), 1); });
test("browser invalid request sends nothing", async () => { const f = browser(); assert.equal((await f.service.verify({ ...input, extra: true } as LogoVerificationRequest)).kind, "invalid-request"); assert.equal(f.calls(), 0); });
test("wire rejects unsafe invariants, internal fields and local-only variants", () => { for (const value of [{ ...verificationResult(observed), writes: "allowed" }, { ...verificationResult(observed), token: "private-token" }, verificationResult({ kind: "session-interrupted" })]) { const result = parseRemoteVerification(value); assert.equal(result.kind, "invalid-response"); invariant(result); } });

for (const phase of ["authenticate", "membership", "inspect"] as const) test(`dependency ${phase} outage is sanitized`, async () => {
  const f = server({ [phase]: async () => { throw new Error("secret-error private-token"); } }); const { result } = await f.run(); assert.equal(result.kind, "service-failure"); assert.equal("metadata" in result, false);
});
test("authentication unavailable is not object absence", async () => { const f = server({ authenticate: async () => ({ kind: "unavailable" }) }); assert.equal((await f.run()).result.kind, "service-failure"); assert.equal(f.calls.includes("info"), false); });
test("post-read expired authentication discards metadata", async () => { let count = 0; const f = server({ authenticate: async () => ++count === 1 ? { kind: "verified", identity } : { kind: "denied" } }); const { result } = await f.run(); assert.equal(result.kind, "authorization-denied"); assert.equal("metadata" in result, false); });
test("post-read membership backend outage discards metadata", async () => { let count = 0; const f = server({ membership: async () => ++count === 1 ? "admin" : "unavailable" }); const { result } = await f.run(); assert.equal(result.kind, "service-failure"); assert.equal("metadata" in result, false); });
test("invalid concurrency lease fails closed before inspection", async () => { const f = server({ acquire: async () => ({ kind: "allowed" } as never) }); assert.equal((await f.run()).result.reason, "abuse-control-unavailable"); assert.equal(f.calls.includes("info"), false); });
test("lease-release outage discards metadata", async () => { const f = server({ acquire: async () => ({ kind: "allowed", release: async () => { throw new Error("secret-error"); } }) }); const { result } = await f.run(); assert.equal(result.reason, "abuse-control-unavailable"); assert.equal("metadata" in result, false); });
test("adapter accepts missing optional metadata but rejects impossible calendar date", async () => { assert.equal((await adapter({ error: null, data: {} }).inspect()).kind, "object-observed"); assert.equal((await adapter({ error: null, data: { createdAt: "2026-02-30T12:00:00Z" } }).inspect()).kind, "invalid-response"); });
test("unrecognized 404 signature remains inconclusive even with recognition configured", async () => { assert.equal((await adapter({ data: null, error: { status: 404, code: "unknown" } }, e => e.code === "fixture-missing").inspect()).kind, "inconclusive"); });

const malformedAuthentications: unknown[] = [
  { kind: "unexpected" }, {}, null, undefined, "verified", [],
  { kind: "verified" }, { kind: "verified", identity: null }, { kind: "verified", identity: {} },
  { kind: "verified", identity: [] }, { kind: "verified", identity: { ...identity, userId: "bad" } },
  { kind: "verified", identity: { ...identity, sessionId: undefined } },
  { kind: "verified", identity: { ...identity, expiresAt: "2000000000" } },
  { kind: "verified", identity: { ...identity, expiresAt: NaN } },
  { kind: "verified", identity: { ...identity, expiresAt: Infinity } },
];
for (const [index, auth] of malformedAuthentications.entries()) {
  test(`malformed initial authentication ${index} stops all protected dependencies`, async () => {
    const f = server({ authenticate: async () => auth as never }); const { result } = await f.run();
    assert.equal(result.kind, "service-failure"); assert.equal("metadata" in result, false); assert.deepEqual(f.calls, []);
  });
  test(`malformed post-read authentication ${index} discards metadata and releases lease`, async () => {
    let checks = 0; const f = server({ authenticate: async () => ++checks === 1 ? { kind: "verified", identity } : auth as never });
    const { result } = await f.run(); assert.equal(result.kind, "service-failure"); assert.equal("metadata" in result, false);
    assert.deepEqual(f.calls, ["member", "acquire", "info", "release"]);
  });
}
for (const changed of [{ ...identity, userId: "bbbbbbbb-0000-0000-0000-000000000002" }, { ...identity, sessionId: "bbbbbbbb-0000-0000-0000-000000000002" }]) test(`post-read changed identity ${JSON.stringify(changed)} is denied`, async () => {
  let checks = 0; const f = server({ authenticate: async () => ({ kind: "verified", identity: ++checks === 1 ? identity : changed }) });
  const { result } = await f.run(); assert.equal(result.kind, "authorization-denied"); assert.equal("metadata" in result, false); assert.deepEqual(f.calls, ["member", "acquire", "info", "release"]);
});
test("same verified session with renewed expiration remains valid", async () => {
  let checks = 0; const f = server({ authenticate: async () => ({ kind: "verified", identity: { ...identity, expiresAt: identity.expiresAt + ++checks } }) });
  assert.equal((await f.run()).result.kind, "object-observed"); assert.deepEqual(f.calls, ["member", "acquire", "info", "member", "release"]);
  // The handler receives one bearer token; browser token rotation is covered by
  // the existing guarded-client test. Expiration equality is not session identity.
});
for (const [method, contentType, body] of [["POST", "application/json", "{"], ["PUT", "application/json", JSON.stringify(input)], ["POST", "text/plain", JSON.stringify(input)]] as const) test(`HTTP contract ${method} ${contentType} ${body}`, async () => {
  let authCalls = 0; const handler = createLogoVerificationHandler({ authenticate: async () => { authCalls++; return { kind: "verified", identity }; }, membership: async () => "admin", acquire: async () => ({ kind: "allowed", release: async () => {} }), inspect: async () => observed });
  const response = await handler(new Request("https://test.invalid", { method, headers: { "content-type": contentType, authorization: "Bearer fake" }, body }));
  assert.equal(response.status, 400); assert.equal(response.headers.get("cache-control"), "no-store"); invariant(await response.json()); assert.equal(authCalls, 0);
});
test("incompatible caller guard prevents transport request", async () => {
  const a = browser(); const b = browser(); const guard = await createSessionContinuityGuard(a.client);
  const result = await b.service.verify(input, { sessionGuard: guard }); invariant(result); assert.equal(result.kind, "session-interrupted"); assert.equal(b.calls(), 0);
});
