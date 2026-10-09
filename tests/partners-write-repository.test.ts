import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { ReadClient } from "../src/lib/supabase/readDataset.ts";
import { MutationError } from "../src/lib/supabase/mutation.ts";
import { createPartnersWriteRepository } from "../src/features/partners/supabaseWriteRepository.ts";

const id = "AAAAAAAA-0000-0000-0000-000000000001";
const content = { name: "Brand", website: "brand.example" };
const row = { id, ...content, logo_path: null as string | null, logo_name: null as string | null, ever_associated: false };
const fails = (kind: string) => (error: unknown) => error instanceof MutationError && error.kind === kind;
function fixture(options: {
  data?: unknown; status?: number; code?: string; logo?: boolean; member?: boolean; noSession?: boolean;
  network?: "before" | "after"; refresh?: "network" | "invalid" | "missing" | "authorization";
  during?: (f: { replace(): void; logout(): void }) => void;
} = {}) {
  let token = "test-token";
  let loggedIn = !options.noSession;
  const requests: { method: string; url: URL; body?: unknown }[] = [];
  const controls = { replace: () => { token = "new-token"; }, logout: () => { loggedIn = false; } };
  const sdk = createClient("https://test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); const method = init?.method ?? "GET";
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.pathname.endsWith("cms_admins")) {
        if (options.network === "before") throw new Error("private token");
        return new Response(JSON.stringify(options.member === false ? null : { user_id: id }), { status: 200, headers: { "content-type": "application/json" } });
      }
      assert.equal(url.pathname, "/rest/v1/partners");
      if (method !== "GET") {
        options.during?.(controls);
        if (options.network === "after") throw new Error("private token");
        return new Response(JSON.stringify(options.code ? { code: options.code, message: "private content", details: token } : "data" in options ? options.data : [{ id, logo_path: options.logo ? "logos/brand.png" : null }]), { status: options.status ?? (options.code ? 400 : 200), headers: { "content-type": "application/json" } });
      }
      if (options.refresh === "network") throw new Error("private content");
      return new Response(JSON.stringify(options.refresh === "authorization" ? { code: "42501", message: token } : options.refresh === "missing" ? null : options.refresh === "invalid" ? { id } : { ...row, logo_path: options.logo ? "logos/brand.png" : null, logo_name: options.logo ? "Original.png" : null }), { status: options.refresh === "authorization" ? 403 : 200, headers: { "content-type": "application/json" } });
    } },
  });
  const client: ReadClient = { from: sdk.from.bind(sdk), auth: { getClaims: (async (jwt: string) => ({ data: { claims: { sub: id, session_id: jwt.includes("replacement") || jwt.includes("changed") || jwt === "new-token" ? "eeeeeeee-0000-0000-0000-000000000001" : "ffffffff-0000-0000-0000-000000000001" } }, error: null })) as NonNullable<ReadClient["auth"]["getClaims"]>, getSession: (async () => ({ data: { session: loggedIn ? { user: { id }, access_token: token } : null }, error: null })) as ReadClient["auth"]["getSession"] } };
  return { repo: createPartnersWriteRepository(client), requests, writes: () => requests.filter(r => r.method !== "GET"), ...controls };
}

test("create sends only editable fields and returns database UUID without logo", async () => {
  const f = fixture();
  const result = await f.repo.create({ ...content, id: "forbidden", ever_associated: true, logo_path: "forbidden", status: "active" } as typeof content);
  assert.equal(result.outcome, "confirmed");
  if (result.outcome !== "confirmed") return;
  assert.equal(result.id, id);
  assert.equal(result.refresh.state, "completed");
  if (result.refresh.state === "completed") {
    assert.equal(result.refresh.value.logo, undefined);
    assert.equal(result.refresh.value.everAssociated, false);
  }
  assert.deepEqual(f.writes()[0].body, content);
  assert.equal(f.writes()[0].method, "POST");
  assert.equal(f.writes()[0].url.searchParams.get("select"), "id");
});

test("update filters UUID and preserves existing logo metadata without writing it", async () => {
  const f = fixture({ logo: true }); const result = await f.repo.update(id, content);
  assert.equal(result.outcome, "confirmed");
  if (result.outcome === "confirmed" && result.refresh.state === "completed") {
    assert.equal(result.refresh.value.logo?.objectPath, "logos/brand.png");
    assert.equal(result.refresh.value.logo?.originalFilename, "Original.png");
    assert.equal(result.refresh.value.logoUrl, undefined);
  } else assert.fail("expected refreshed projection");
  assert.equal(f.writes()[0].method, "PATCH");
  assert.equal(f.writes()[0].url.searchParams.get("id"), `eq.${id}`);
  assert.deepEqual(f.writes()[0].body, content);
});

for (const logo of [false, true]) test(`delete confirms one row and reports logo cleanup ${logo}`, async () => {
  const f = fixture({ logo }); const result = await f.repo.remove(id);
  assert.equal(result.outcome, "confirmed");
  if (result.outcome === "confirmed") assert.equal(result.cleanup.state, logo ? "pending" : "not-needed");
  assert.equal(f.writes()[0].method, "DELETE");
  assert.equal(f.writes()[0].url.searchParams.get("select"), "id,logo_path");
  assert.equal(f.writes().length, 1);
});

test("delete with unknown logo metadata conservatively leaves cleanup pending", async () => {
  const f = fixture({ data: [{ id }] }); const result = await f.repo.remove(id);
  assert.equal(result.outcome, "confirmed");
  if (result.outcome === "confirmed") assert.equal(result.cleanup.state, "pending");
});

test("historical deletion rejection remains a domain error without bypass", async () => {
  const f = fixture({ code: "P0001" });
  await assert.rejects(f.repo.remove(id), fails("domain"));
  assert.equal(f.writes().length, 1);
});

for (const operation of ["update", "remove"] as const) test(`${operation} zero rows is missing/inaccessible, never confirmed`, async () => {
  const f = fixture({ data: [] });
  await assert.rejects(operation === "update" ? f.repo.update(id, content) : f.repo.remove(id), fails("missing"));
});

for (const [code, kind] of [["42501", "authorization"], ["23514", "domain"], ["23503", "domain"], ["23505", "conflict"]] as const) test(`definitive ${code} rejection is ${kind}`, async () => {
  const f = fixture({ code }); await assert.rejects(f.repo.create(content), fails(kind));
  assert.equal(f.writes().length, 1);
});

for (const auth of ["member", "noSession"] as const) test(`unauthorized ${auth} performs no mutations`, async () => {
  const f = fixture(auth === "member" ? { member: false } : { noSession: true });
  await assert.rejects(f.repo.create(content), fails("authorization"));
  assert.equal(f.writes().length, 0);
});

for (const data of [null, [], [{ id: "bad" }], [{ id }, { id }]]) test(`unexpected mutation payload ${JSON.stringify(data)} cannot confirm persistence`, async () => {
  const f = fixture({ data }); const result = await f.repo.create(content);
  assert.equal(result.outcome, "uncertain");
  if (result.outcome === "uncertain") assert.equal(result.error.kind, "response");
});

test("mismatched returned UUID is uncertain with known target", async () => {
  const f = fixture({ data: [{ id: "BBBBBBBB-0000-0000-0000-000000000002" }] });
  const result = await f.repo.update(id, content);
  assert.equal(result.outcome, "uncertain"); assert.equal(result.id, id);
});

test("network failure before dispatch performs no mutations", async () => {
  const f = fixture({ network: "before" }); await assert.rejects(f.repo.create(content), fails("response"));
  assert.equal(f.writes().length, 0);
});

test("network loss after dispatch is uncertain and is never retried", async () => {
  const f = fixture({ network: "after" }); const result = await f.repo.update(id, content);
  assert.equal(result.outcome, "uncertain"); assert.equal(result.id, id);
  if (result.outcome === "uncertain") {
    assert.equal(result.error.kind, "uncertain"); assert.equal(result.error.retryAutomatically, false);
    assert.doesNotMatch(JSON.stringify(result.error), /private|token/);
  }
  assert.equal(f.writes().length, 1);
});

test("gateway failure remains uncertain without retry", async () => {
  const f = fixture({ status: 503, code: "XX000" }); const result = await f.repo.create(content);
  assert.equal(result.outcome, "uncertain"); assert.equal(f.writes().length, 1);
});

test("abort before dispatch does not mutate", async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.repo.create(content, { signal: controller.signal }), fails("cancelled"));
  assert.equal(f.requests.length, 0);
});

test("abort after dispatch with lost response is uncertain", async () => {
  const controller = new AbortController(); const f = fixture({ network: "after", during: () => controller.abort() });
  const result = await f.repo.create(content, { signal: controller.signal });
  assert.equal(result.outcome, "uncertain"); assert.equal(f.writes().length, 1);
});

for (const change of ["replace", "logout", "abort"] as const) test(`${change} after authoritative acknowledgment preserves confirmation and suppresses snapshot`, async () => {
  const controller = new AbortController(); const f = fixture({ during: controls => change === "abort" ? controller.abort() : controls[change]() });
  const result = await f.repo.update(id, content, { signal: controller.signal });
  assert.equal(result.outcome, "confirmed");
  if (result.outcome === "confirmed") {
    assert.equal(result.refresh.state, "failed");
    if (result.refresh.state === "failed") assert.equal(result.refresh.error.kind, "stale");
  }
  assert.equal(f.requests.filter(r => r.url.pathname.endsWith("partners") && r.method === "GET").length, 0);
});

for (const refresh of ["network", "invalid", "missing", "authorization"] as const) test(`confirmed write with ${refresh} refresh failure stays confirmed`, async () => {
  const f = fixture({ refresh }); const result = await f.repo.create(content);
  assert.equal(result.outcome, "confirmed");
  if (result.outcome === "confirmed") assert.equal(result.refresh.state, "failed");
  assert.equal(f.writes().length, 1);
});

test("invalid content or identifier fails locally without mutation", async () => {
  const f = fixture();
  assert.throws(() => f.repo.create({ ...content, name: " " }), fails("domain"));
  assert.throws(() => f.repo.update("slug", content), fails("response"));
  assert.equal(f.requests.length, 0);
});
