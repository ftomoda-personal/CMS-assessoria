import assert from "node:assert/strict";
import { test } from "node:test";
import { createVerificationHttpSecurity, verificationBearer } from "../server/partner-logo-verification/httpSecurity.ts";
import { verificationInvariants, verificationResult } from "../src/features/partners/logoVerificationContracts.ts";
const origin = "https://cms.example";
const input = JSON.stringify({ version: 1, objectPath: "logos/aaaaaaaa-0000-0000-0000-000000000001.png" });
const observed = () => new Response(JSON.stringify(verificationResult({ kind: "object-observed", metadata: { sizeBytes: 8 } })), { status: 200 });
function request(body: BodyInit = input, extra: { method?: string; headers?: Record<string, string>; signal?: AbortSignal } = {}) {
  return new Request("https://endpoint.invalid", { method: extra.method ?? "POST", headers: { origin, "content-type": "application/json", authorization: "Bearer private-token", ...extra.headers }, body, signal: extra.signal, duplex: "half" } as RequestInit);
}
async function safe(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store"); const result = await response.json();
  for (const [key, value] of Object.entries(verificationInvariants)) assert.equal(result[key], value);
  assert.doesNotMatch(JSON.stringify(result), /private-token|secret/); return result;
}
for (const [header, expected] of [["Bearer private-token", "private-token"], [null, undefined], ["", undefined], ["Bearer ", undefined], ["Bearer a b", undefined], ["Basic token", undefined], ["Bearer token\n", undefined]] as const) test(`bearer ${JSON.stringify(header)}`, () => { assert.equal(verificationBearer(header), expected); });
test("POST bounded stream forwarded once, sanitized and no-store", async () => {
  let calls = 0; const wrapper = createVerificationHttpSecurity(async r => { calls++; assert.equal(await r.text(), input); assert.equal(r.headers.get("authorization"), "Bearer private-token"); return observed(); }, { allowedOrigins: [origin], maxBodyBytes: 512, deadlineMs: 1000 });
  const response = await wrapper(request()); assert.equal(response.headers.get("access-control-allow-origin"), origin); assert.equal((await safe(response)).kind, "object-observed"); assert.equal(calls, 1);
});
test("OPTIONS is explicit, no authentication or handler call", async () => {
  let calls = 0; const wrapper = createVerificationHttpSecurity(async () => { calls++; return observed(); }, { allowedOrigins: [origin], maxBodyBytes: 512, deadlineMs: 1000 });
  const response = await wrapper(new Request("https://endpoint.invalid", { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "Authorization, Content-Type" } }));
  assert.equal(response.status, 204); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("access-control-allow-methods"), "POST"); assert.equal(calls, 0);
});
for (const value of ["https://evil.example", "https://cms.example.evil", "null", ""]) test(`origin denied ${value}`, async () => {
  let calls = 0; const wrapper = createVerificationHttpSecurity(async () => { calls++; return observed(); }, { allowedOrigins: [origin], maxBodyBytes: 512, deadlineMs: 1000 });
  const response = await wrapper(request(input, { headers: { origin: value } })); assert.equal(response.status, 403); assert.equal(response.headers.has("access-control-allow-origin"), false); await safe(response); assert.equal(calls, 0);
});
for (const extra of [{ method: "PUT" }, { headers: { "content-type": "text/plain" } }, { headers: { authorization: "Basic fake" } }] as { method?: string; headers?: Record<string, string> }[]) test(`HTTP rejection ${JSON.stringify(extra)}`, async () => {
  let calls = 0; const wrapper = createVerificationHttpSecurity(async () => { calls++; return observed(); }, { allowedOrigins: [origin], maxBodyBytes: 512, deadlineMs: 1000 });
  const response = await wrapper(request(input, extra)); assert.ok([400, 403].includes(response.status)); await safe(response); assert.equal(calls, 0);
});
for (const length of ["1000", "invalid", "-1"]) test(`early content-length ${length} avoids any stream read`, async () => {
  let pulls = 0; let calls = 0; const stream = new ReadableStream<Uint8Array>({ pull() { pulls++; } }, { highWaterMark: 0 });
  const wrapper = createVerificationHttpSecurity(async () => { calls++; return observed(); }, { allowedOrigins: [origin], maxBodyBytes: 100, deadlineMs: 1000 });
  const response = await wrapper(request(stream, { headers: { "content-length": length } })); assert.equal(response.status, 400); await safe(response); assert.equal(pulls, 0); assert.equal(calls, 0);
});
for (const length of [undefined, "1"]) test(`stream byte limit enforces without trusting content-length=${length}`, async () => {
  let pulls = 0; let cancels = 0; let calls = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(c) { pulls++; c.enqueue(new Uint8Array(60)); }, cancel() { cancels++; } }, { highWaterMark: 0 });
  const r = request(stream, { headers: length ? { "content-length": length } : {} });
  r.text = async () => { throw new Error("full-buffer method called"); }; r.json = async () => { throw new Error("full-buffer method called"); }; r.arrayBuffer = async () => { throw new Error("full-buffer method called"); };
  const wrapper = createVerificationHttpSecurity(async () => { calls++; return observed(); }, { allowedOrigins: [origin], maxBodyBytes: 100, deadlineMs: 1000 });
  const response = await wrapper(r); assert.equal(response.status, 400); await safe(response); assert.equal(pulls, 2); assert.equal(cancels, 1); assert.equal(calls, 0);
});
test("limit counts UTF-8 bytes rather than characters", async () => {
  const wrapper = createVerificationHttpSecurity(async () => observed(), { allowedOrigins: [origin], maxBodyBytes: 3, deadlineMs: 1000 });
  assert.equal((await wrapper(request("éé"))).status, 400);
});
for (const timeout of [true, false]) test(`pending handler timeout=${timeout} discards late metadata`, async () => {
  let expire = () => {}; let resume = () => {}; let entered = () => {}; let clears = 0; let forwarded: AbortSignal | undefined;
  const started = new Promise<void>(r => { entered = r; }); const pending = new Promise<void>(r => { resume = r; }); const controller = new AbortController();
  const wrapper = createVerificationHttpSecurity(async r => { forwarded = r.signal; entered(); await pending; return observed(); }, { allowedOrigins: [origin], maxBodyBytes: 512, deadlineMs: 1000, scheduleTimeout: fn => { expire = fn; return () => { clears++; }; } });
  const responsePromise = wrapper(request(input, { signal: controller.signal })); await started; if (timeout) expire(); else controller.abort();
  const response = await responsePromise; const result = await safe(response); assert.equal(response.status, timeout ? 504 : 499); assert.equal(result.kind, timeout ? "service-failure" : "cancelled"); assert.equal("metadata" in result, false); assert.equal(forwarded?.aborted, true); assert.equal(clears, 1); resume();
});
test("deadline while stream stalls cancels reader and skips handler", async () => {
  let expire = () => {}; let cancel = 0; let calls = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancel++; } }, { highWaterMark: 0 });
  const wrapper = createVerificationHttpSecurity(async () => { calls++; return observed(); }, { allowedOrigins: [origin], maxBodyBytes: 512, deadlineMs: 1000, scheduleTimeout: fn => { expire = fn; return () => {}; } });
  const pending = wrapper(request(stream)); expire(); const response = await pending; assert.equal(response.status, 504); await safe(response); assert.equal(calls, 0); assert.equal(cancel, 1);
});
test("already cancelled request skips handler", async () => { let calls = 0; const controller = new AbortController(); controller.abort(); const wrapper = createVerificationHttpSecurity(async () => { calls++; return observed(); }, { allowedOrigins: [origin], maxBodyBytes: 512, deadlineMs: 1000 }); const response = await wrapper(request(input, { signal: controller.signal })); assert.equal((await safe(response)).kind, "cancelled"); assert.equal(calls, 0); });
test("exceptions sanitized and unsafe remote metadata rejected", async () => {
  for (const handler of [async () => { throw new Error("secret private-token"); }, async () => new Response(JSON.stringify({ ...verificationResult({ kind: "object-observed", metadata: {} }), token: "private-token" }))]) {
    const wrapper = createVerificationHttpSecurity(handler, { allowedOrigins: [origin], maxBodyBytes: 512, deadlineMs: 1000 }); const response = await wrapper(request()); const result = await safe(response); assert.ok(["service-failure", "invalid-response"].includes(result.kind)); assert.equal("metadata" in result, false);
  }
});

test("OPTIONS disallowed requested headers do not reach handler", async () => { let calls = 0; const wrapper = createVerificationHttpSecurity(async () => { calls++; return observed(); }, { allowedOrigins: [origin], maxBodyBytes: 512, deadlineMs: 1000 }); const response = await wrapper(new Request("https://endpoint.invalid", { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "X-Unknown" } })); assert.equal(response.status, 400); await safe(response); assert.equal(calls, 0); });
test("missing origin is denied by default", async () => { const wrapper = createVerificationHttpSecurity(async () => observed(), { allowedOrigins: [origin], maxBodyBytes: 512, deadlineMs: 1000 }); const r = request(); r.headers.delete("origin"); assert.equal((await wrapper(r)).status, 403); });

test("inconsistent HTTP denial carrying metadata is discarded", async () => { const wrapper = createVerificationHttpSecurity(async () => new Response(JSON.stringify(verificationResult({ kind: "object-observed", metadata: { sizeBytes: 8 } })), { status: 403 }), { allowedOrigins: [origin], maxBodyBytes: 512, deadlineMs: 1000 }); const response = await wrapper(request()); assert.equal(response.status, 502); const result = await safe(response); assert.equal(result.kind, "invalid-response"); assert.equal("metadata" in result, false); });

for (const [contentType, accepted] of [
  ["application/json", true], ["Application/JSON", true], ["Application/JSON; charset=utf-8", true],
  ['APPLICATION/JSON; Charset="UTF-8"', true], ['application/json; note="a;b"', true],
  ["text/plain", false], ["application/jsonx", false], ["application/json, text/plain", false],
  ["application/json;", false], ["application/json; charset", false], ["application/json; charset=", false],
  ['application/json; charset="utf-8', false], ["application/json; charset=utf-8; CHARSET=utf-8", false],
  ["application/json; charset=iso-8859-1", false], ["application/json; charset=utf-8, application/json", false],
] as const) test(`wrapper Content-Type ${contentType}`, async () => {
  let calls = 0; const wrapper = createVerificationHttpSecurity(async () => { calls++; return observed(); }, { allowedOrigins: [origin], maxBodyBytes: 512, deadlineMs: 1000 });
  const response = await wrapper(request(input, { headers: { "content-type": contentType } }));
  assert.equal(response.status, accepted ? 200 : 400); const result = await safe(response); assert.equal(result.kind, accepted ? "object-observed" : "invalid-request"); assert.equal(calls, accepted ? 1 : 0);
});
