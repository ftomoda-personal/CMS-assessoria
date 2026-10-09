import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createPartnerLogoRepository } from "../src/features/partners/supabaseLogoRepository.ts";
import type { LogoClient } from "../src/features/partners/supabaseLogoRepository.ts";
import { MutationError } from "../src/lib/supabase/mutation.ts";

const id = "AAAAAAAA-0000-0000-0000-000000000001";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const jpeg = new Uint8Array([255, 216, 255, 224]);
const file = (type = "image/png", size = 16, name = "Original brand.png") => {
  const bytes = new Uint8Array(size); bytes.set((type === "image/jpeg" ? jpeg : png).slice(0, size));
  return new File([bytes], name, { type });
};
const fails = (kind: string) => (error: unknown) => error instanceof MutationError && error.kind === kind;
function fixture(options: { member?: boolean; noSession?: boolean; status?: number; network?: boolean; malformed?: boolean;
  duringUpload?: (controls: { replace(): void; logout(): void }) => void; duringMembership?: () => void;
} = {}) {
  let token = "test-token"; let loggedIn = !options.noSession; let seq = 1;
  const requests: { url: URL; method: string; init?: RequestInit }[] = [];
  const controls = { replace: () => { token = "new-token"; }, logout: () => { loggedIn = false; } };
  const sdk = createClient("https://test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); const method = init?.method ?? "GET"; requests.push({ url, method, init });
      if (url.pathname.endsWith("cms_admins")) {
        assert.equal(method, "GET"); options.duringMembership?.();
        return new Response(JSON.stringify(options.member === false ? null : { user_id: id }), { headers: { "content-type": "application/json" } });
      }
      assert.match(url.pathname, /^\/storage\/v1\/object\/partner-logos\/logos\//); assert.equal(method, "POST");
      options.duringUpload?.(controls);
      if (options.network) throw new Error("private credentials");
      return new Response(JSON.stringify(options.status ? { statusCode: String(options.status), message: "private token" } : options.malformed ? { Id: id, Key: "wrong" } : { Id: id, Key: url.pathname.slice("/storage/v1/object/".length) }), { status: options.status ?? 200, headers: { "content-type": "application/json" } });
    } },
  });
  const client: LogoClient = { from: sdk.from.bind(sdk), storage: sdk.storage, auth: { getSession: (async () => ({ data: { session: loggedIn ? { user: { id }, access_token: token } : null }, error: null })) as LogoClient["auth"]["getSession"] } };
  const repo = createPartnerLogoRepository(client, { randomUUID: () => `AAAAAAAA-0000-0000-0000-${String(seq++).padStart(12, "0")}` });
  return { repo, requests, uploads: () => requests.filter(r => r.method === "POST"), ...controls };
}

for (const [mime, ext] of [["image/png", "png"], ["image/jpeg", "jpg"]] as const) test(`${mime} upload preserves filename and separates path from URL`, async () => {
  const f = fixture(); const original = "Marca original com espaços & acentos.png";
  const result = await f.repo.upload(file(mime, 16, original));
  assert.equal(result.outcome, "confirmed"); if (result.outcome === "confirmed") assert.equal(result.canApply, true);
  assert.equal(result.originalFilename, original); assert.equal(result.bucket, "partner-logos");
  assert.equal(result.objectPath, `logos/aaaaaaaa-0000-0000-0000-000000000001.${ext}`);
  assert.equal("publicUrl" in result, false);
  assert.equal(new Headers(f.uploads()[0].init?.headers).get("x-upsert"), "false");
  assert.equal(f.uploads().length, 1);
});

test("2 MiB is accepted exactly, and a fresh lowercase UUID is used for every upload", async () => {
  const f = fixture(); const first = await f.repo.upload(file("image/png", 2097152)); const second = await f.repo.upload(file());
  assert.equal(first.outcome, "confirmed"); assert.notEqual(first.objectPath, second.objectPath);
  assert.equal(first.objectPath, first.objectPath.toLowerCase());
});

for (const size of [0, 2097153]) test(`invalid size ${size} fails before any requests`, async () => {
  const f = fixture(); await assert.rejects(f.repo.upload(file("image/png", size)), fails("domain")); assert.equal(f.requests.length, 0);
});

for (const mime of ["image/svg+xml", "text/plain", "image/gif", "", "image/jpg"]) test(`unsupported MIME ${mime} fails locally`, async () => {
  const f = fixture(); await assert.rejects(f.repo.upload(file(mime)), fails("domain")); assert.equal(f.requests.length, 0);
});

test("declared MIME and filename do not bypass signature checks", async () => {
  const f = fixture();
  await assert.rejects(f.repo.upload(new File(["not a PNG"], "logo.png", { type: "image/png" })), fails("domain"));
  await assert.rejects(f.repo.upload(new File([png], "logo.jpg", { type: "image/jpeg" })), fails("domain"));
  assert.equal(f.requests.length, 0);
});

test("extension is generated from validated MIME rather than original filename", async () => {
  const f = fixture(); const result = await f.repo.upload(file("image/jpeg", 16, "name.without-approved-extension"));
  assert.match(result.objectPath, /[.]jpg$/); assert.equal(result.originalFilename, "name.without-approved-extension");
});

for (const path of ["../logo.png", "other/aaaaaaaa-0000-0000-0000-000000000001.png", "logos/nested/aaaaaaaa-0000-0000-0000-000000000001.png", "logos/AAAAAAAA-0000-0000-0000-000000000001.png", "logos/aaaaaaaa-0000-0000-0000-000000000001.svg", "logos/aaaaaaaa-0000-0000-0000-000000000001.png\n"]) test(`invalid path ${JSON.stringify(path)} is rejected`, () => {
  const f = fixture(); assert.throws(() => f.repo.resolvePublicUrl(path), fails("response")); assert.equal(f.requests.length, 0);
});

test("public URL resolution performs no existence, listing or metadata request", () => {
  const f = fixture(); const path = "logos/aaaaaaaa-0000-0000-0000-000000000001.png";
  assert.equal(f.repo.resolvePublicUrl(path), `https://test.invalid/storage/v1/object/public/partner-logos/${path}`);
  assert.equal(f.requests.length, 0);
});

for (const auth of [{ member: false }, { noSession: true }]) test(`auth preflight ${JSON.stringify(auth)} prevents upload`, async () => {
  const f = fixture(auth); await assert.rejects(f.repo.upload(file()), fails("authorization")); assert.equal(f.uploads().length, 0);
});

test("already aborted request does no work", async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.repo.upload(file(), { signal: controller.signal }), fails("cancelled")); assert.equal(f.requests.length, 0);
});

test("abort during membership verification prevents upload dispatch", async () => {
  const controller = new AbortController(); const f = fixture({ duringMembership: () => controller.abort() });
  await assert.rejects(f.repo.upload(file(), { signal: controller.signal }), fails("cancelled")); assert.equal(f.uploads().length, 0);
});

test("lost response preserves generated path for reconciliation and never retries", async () => {
  const f = fixture({ network: true }); const result = await f.repo.upload(file());
  assert.equal(result.outcome, "uncertain"); assert.match(result.objectPath, /^logos\//);
  if (result.outcome === "uncertain") { assert.equal(result.error.kind, "uncertain"); assert.equal(result.error.retryAutomatically, false); assert.doesNotMatch(JSON.stringify(result.error), /private|credentials/); }
  assert.equal(f.uploads().length, 1);
});

test("abort after dispatch with lost response is uncertain, never confirmed cancellation", async () => {
  const controller = new AbortController(); const f = fixture({ network: true, duringUpload: () => controller.abort() });
  const result = await f.repo.upload(file(), { signal: controller.signal });
  assert.equal(result.outcome, "uncertain"); if (result.outcome === "uncertain") assert.equal(result.error.kind, "uncertain");
  assert.equal(f.uploads().length, 1);
});

for (const change of ["replace", "logout", "abort"] as const) test(`${change} during acknowledged upload suppresses attachment but preserves confirmation`, async () => {
  const controller = new AbortController(); const f = fixture({ duringUpload: controls => change === "abort" ? controller.abort() : controls[change]() });
  const result = await f.repo.upload(file(), { signal: controller.signal });
  assert.equal(result.outcome, "confirmed"); if (result.outcome === "confirmed") assert.equal(result.canApply, false);
  assert.equal(f.uploads().length, 1);
});

for (const [status, kind] of [[403, "authorization"], [409, "conflict"], [413, "domain"]] as const) test(`definitive Storage ${status} rejection is sanitized ${kind}`, async () => {
  const f = fixture({ status }); await assert.rejects(f.repo.upload(file()), error => { assert.ok(fails(kind)(error)); assert.doesNotMatch(JSON.stringify(error), /private|token/); return true; });
  assert.equal(f.uploads().length, 1);
});

test("gateway error and unexpected acknowledgment remain uncertain", async () => {
  for (const options of [{ status: 503 }, { malformed: true }]) {
    const f = fixture(options); const result = await f.repo.upload(file());
    assert.equal(result.outcome, "uncertain"); assert.equal(f.uploads().length, 1);
  }
});

test("only membership SELECT and Storage INSERT are reachable; no delete or Partner writes", async () => {
  const f = fixture(); await f.repo.upload(file());
  assert.equal(f.requests.every(r => r.method === "GET" && r.url.pathname.endsWith("cms_admins") || r.method === "POST" && r.url.pathname.startsWith("/storage/v1/object/partner-logos/")), true);
  assert.equal("remove" in f.repo, false); assert.equal("update" in f.repo, false);
});
