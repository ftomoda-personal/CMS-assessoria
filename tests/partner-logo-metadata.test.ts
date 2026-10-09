import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createPartnersWriteRepository } from "../src/features/partners/supabaseWriteRepository.ts";
import { prepareLogoUpload } from "../src/features/partners/logoIntegrationContracts.ts";
import type { LogoMetadataReference, PreparedLogoUpload } from "../src/features/partners/logoIntegrationContracts.ts";
import type { ReadClient } from "../src/lib/supabase/readDataset.ts";
import { MutationError, parsePersistedUuid } from "../src/lib/supabase/mutation.ts";

const id = parsePersistedUuid("aaaaaaaa-0000-0000-0000-000000000001");
const path = "logos/bbbbbbbb-0000-0000-0000-000000000002.jpg";
const empty = { logo_path: null, logo_name: null };
const old = { logo_path: "logos/old.png", logo_name: "Old.png" };
function prepared(expected?: LogoMetadataReference): PreparedLogoUpload {
  return prepareLogoUpload({ operationId: "cccccccc-0000-0000-0000-000000000003", initiatingAdminId: id, target: expected ? { kind: "edit", id, expectedLogo: expected } : { kind: "create" } }, { outcome: "confirmed", canApply: true, bucket: "partner-logos", objectPath: path, originalFilename: "Original.jpeg" });
}
function fixture(options: { initial?: LogoMetadataReference; zero?: boolean; missing?: boolean; concurrent?: LogoMetadataReference;
  code?: string; status?: number; network?: boolean; refreshError?: boolean; member?: boolean; wrongUser?: boolean;
  during?: (f: { replace(): void; logout(): void }) => void;
} = {}) {
  let token = "test-token"; let loggedIn = true;
  let stored = { id, name: "Brand", website: "brand.example", ever_associated: false, ...(options.initial ?? empty) };
  const requests: { method: string; url: URL; body?: Record<string, unknown> }[] = [];
  const controls = { replace: () => { token = "new-token"; }, logout: () => { loggedIn = false; } };
  const sdk = createClient("https://test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined; requests.push({ url, method, body });
      const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith("cms_admins")) return respond(options.member === false ? null : { user_id: options.wrongUser ? "dddddddd-0000-0000-0000-000000000004" : id });
      assert.equal(url.pathname, "/rest/v1/partners");
      if (method === "GET") return respond(options.refreshError ? { code: "42501", message: "private" } : options.missing ? null : stored, options.refreshError ? 403 : 200);
      assert.ok(method === "PATCH" || method === "POST"); options.during?.(controls);
      if (options.network) throw new Error("private-token");
      if (options.code) return respond({ code: options.code, message: "private" }, options.status ?? 400);
      if (options.concurrent) stored = { ...stored, ...options.concurrent };
      const matches = (["logo_path", "logo_name"] as const).every(field => {
        const filter = url.searchParams.get(field);
        return !filter || filter === (stored[field] === null ? "is.null" : `eq.${stored[field]}`);
      });
      if (options.zero || !matches) return respond([]);
      stored = { ...stored, ...body }; return respond([{ id }]);
    } },
  });
  const client: ReadClient = { from: sdk.from.bind(sdk), auth: { getClaims: (async (jwt: string) => ({ data: { claims: { sub: options.wrongUser ? "dddddddd-0000-0000-0000-000000000004" : id, session_id: jwt.includes("replacement") || jwt.includes("changed") || jwt === "new-token" ? "eeeeeeee-0000-0000-0000-000000000001" : "ffffffff-0000-0000-0000-000000000001" } }, error: null })) as NonNullable<ReadClient["auth"]["getClaims"]>, getSession: (async () => ({ data: { session: loggedIn ? { user: { id: options.wrongUser ? "dddddddd-0000-0000-0000-000000000004" : id }, access_token: token } : null }, error: null })) as ReadClient["auth"]["getSession"] } };
  return { repo: createPartnersWriteRepository(client), requests, writes: () => requests.filter(r => r.method !== "GET"), stored: () => stored };
}
const fails = (kind: string) => (error: unknown) => error instanceof MutationError && error.kind === kind;

test("create with prepared metadata sends paired fields and leaves UUID database-owned", async () => {
  const f = fixture(); const result = await f.repo.createWithLogo({ name: "Brand", website: "brand.example" }, prepared());
  assert.equal(result.outcome, "confirmed"); assert.equal(result.id, id);
  assert.deepEqual(f.writes()[0].body, { name: "Brand", website: "brand.example", logo_path: path, logo_name: "Original.jpeg" });
  assert.equal(f.writes()[0].method, "POST");
});

for (const expected of [empty, old, { logo_path: old.logo_path, logo_name: null }]) test(`assign/replace atomically compares ${JSON.stringify(expected)}`, async () => {
  const f = fixture({ initial: expected }); const result = await f.repo.setLogo(id, expected, prepared(expected));
  assert.equal(result.outcome, "confirmed");
  assert.deepEqual(f.writes()[0].body, { logo_path: path, logo_name: "Original.jpeg" });
  for (const field of ["logo_path", "logo_name"] as const) assert.equal(f.writes()[0].url.searchParams.get(field), expected[field] === null ? "is.null" : `eq.${expected[field]}`);
  assert.equal(f.requests.find(r => r.url.pathname.endsWith("partners"))?.method, "PATCH");
  assert.equal(f.stored().logo_path, path);
});

test("remove reference writes both nulls conditionally and never deletes object", async () => {
  const f = fixture({ initial: old }); const result = await f.repo.removeLogo(id, old);
  assert.equal(result.outcome, "confirmed"); assert.deepEqual(f.writes()[0].body, empty);
  assert.equal(f.writes()[0].method, "PATCH"); assert.equal(f.stored().logo_path, null);
});

for (const changed of [{ ...old, logo_path: "logos/concurrent.png" }, { ...old, logo_name: "Concurrent.png" }]) test(`concurrent ${JSON.stringify(changed)} change proves conflict and preserves current reference`, async () => {
  const f = fixture({ initial: old, concurrent: changed });
  await assert.rejects(f.repo.setLogo(id, old, prepared(old)), fails("conflict"));
  assert.equal(f.stored().logo_path, changed.logo_path); assert.equal(f.stored().logo_name, changed.logo_name);
  assert.equal(f.writes().length, 1);
});

test("zero rows with matching metadata is unexplained response, not conflict or success", async () => {
  const f = fixture({ zero: true, initial: old }); await assert.rejects(f.repo.removeLogo(id, old), fails("response"));
});

test("zero rows and absent/inaccessible row yields missing without claiming conflict", async () => {
  const f = fixture({ zero: true, missing: true }); await assert.rejects(f.repo.removeLogo(id, empty), fails("missing"));
});

test("zero rows with read authorization error cannot prove conflict", async () => {
  const f = fixture({ zero: true, refreshError: true }); await assert.rejects(f.repo.removeLogo(id, empty), fails("authorization"));
});

test("confirmed metadata write remains confirmed after failed refresh", async () => {
  const f = fixture({ refreshError: true }); const result = await f.repo.setLogo(id, empty, prepared(empty));
  assert.equal(result.outcome, "confirmed"); if (result.outcome === "confirmed") assert.equal(result.refresh.state, "failed");
});

for (const [code, kind] of [["42501", "authorization"], ["23514", "domain"]] as const) test(`definitive ${code} rejection is ${kind} and leaves old reference`, async () => {
  const f = fixture({ code, initial: old }); await assert.rejects(f.repo.removeLogo(id, old), fails(kind));
  assert.equal(f.stored().logo_path, old.logo_path); assert.equal(f.writes().length, 1);
});

test("lost mutation response is uncertain with target UUID and no retry", async () => {
  const f = fixture({ network: true }); const result = await f.repo.setLogo(id, empty, prepared(empty));
  assert.equal(result.outcome, "uncertain"); assert.equal(result.id, id); assert.equal(f.writes().length, 1);
});

test("abort before dispatch prevents metadata write", async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.repo.removeLogo(id, empty, { signal: controller.signal }), fails("cancelled")); assert.equal(f.writes().length, 0);
});

test("abort after dispatch with lost response is uncertain", async () => {
  const controller = new AbortController(); const f = fixture({ network: true, during: () => controller.abort() });
  assert.equal((await f.repo.removeLogo(id, empty, { signal: controller.signal })).outcome, "uncertain"); assert.equal(f.writes().length, 1);
});

for (const change of ["replace", "logout"] as const) test(`${change} after confirmed write suppresses refreshed snapshot`, async () => {
  const f = fixture({ during: controls => controls[change]() }); const result = await f.repo.setLogo(id, empty, prepared(empty));
  assert.equal(result.outcome, "confirmed"); if (result.outcome === "confirmed") { assert.equal(result.refresh.state, "failed"); if (result.refresh.state === "failed") assert.equal(result.refresh.error.kind, "stale"); }
});

test("prepared upload from another initiating admin cannot dispatch", async () => {
  const f = fixture({ wrongUser: true }); await assert.rejects(f.repo.setLogo(id, empty, prepared(empty)), fails("stale")); assert.equal(f.writes().length, 0);
});

test("public URL or wrong prepared target fails before requests", () => {
  const f = fixture();
  assert.throws(() => f.repo.createWithLogo({ name: "Brand", website: "brand.example" }, { ...prepared(), metadata: { ...prepared().metadata, objectPath: "https://example.com/logo.png" } }), fails("response"));
  assert.throws(() => f.repo.setLogo(id, empty, prepared()), fails("response"));
  assert.throws(() => f.repo.setLogo(id, old, prepared(empty)), fails("response"));
  assert.equal(f.requests.length, 0);
});

test("name/website-only update still omits logo metadata", async () => {
  const f = fixture({ initial: old }); await f.repo.update(id, { name: "Changed", website: "changed.example" });
  assert.deepEqual(f.writes()[0].body, { name: "Changed", website: "changed.example" }); assert.equal(f.stored().logo_path, old.logo_path);
});
