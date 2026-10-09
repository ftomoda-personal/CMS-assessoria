import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createOffersWriteRepository } from "../src/features/offers/supabaseWriteRepository.ts";
import type { OffersWriteClient, OfferWriteResult } from "../src/features/offers/supabaseWriteRepository.ts";
import type { OfferSaveContent } from "../src/features/offers/mappers.ts";
import { MutationError } from "../src/lib/supabase/mutation.ts";

const id = "AAAAAAAA-0000-0000-0000-000000000001";
const partnerId = "BBBBBBBB-0000-0000-0000-000000000002";
const otherPartner = "CCCCCCCC-0000-0000-0000-000000000003";
const content: OfferSaveContent = { title: "", description: "", publicationMode: "now", hasCoupon: false, hasExpiration: false };
const raw = { id, partner_id: null, title: "", subtitle: null, description: "", publication_mode: "now", has_coupon: false, coupon: null, has_expiration: false, starts_on: null, expires_on: null, published_at: null, enabled: true, deleted_at: null };
const fails = (kind: string) => (error: unknown) => error instanceof MutationError && error.kind === kind;
function fixture(options: {
  raw?: Record<string, unknown>; data?: unknown; code?: string; status?: number; message?: string;
  effective?: unknown; refresh?: "network" | "missing"; noSession?: boolean; member?: boolean;
  network?: boolean; during?: (f: { replace(): void; logout(): void }) => void;
  duringRefresh?: (f: { replace(): void; logout(): void }) => void;
} = {}) {
  let token = "test-token"; let loggedIn = !options.noSession;
  const requests: { url: URL; method: string; body?: Record<string, unknown> }[] = [];
  const controls = { replace: () => { token = "new-token"; }, logout: () => { loggedIn = false; } };
  const row = { ...raw, ...options.raw };
  const sdk = createClient("https://test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); const method = init?.method ?? "GET";
      requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.pathname.endsWith("cms_admins")) return new Response(JSON.stringify(options.member === false ? null : { user_id: id }), { headers: { "content-type": "application/json" } });
      if (url.pathname.includes("/rpc/")) {
        assert.equal(method, "POST"); options.during?.(controls);
        if (options.network) throw new Error("private token content");
        if (url.pathname.endsWith("soft_delete_offer") && !("data" in options) && !options.code) return new Response(null, { status: 204 });
        return new Response(JSON.stringify(options.code ? { code: options.code, message: options.message ?? token, details: "private" } : "data" in options ? options.data : [row]), { status: options.status ?? (options.code ? 400 : 200), headers: { "content-type": "application/json" } });
      }
      assert.equal(url.pathname, "/rest/v1/offers"); assert.equal(method, "GET");
      options.duringRefresh?.(controls);
      if (options.refresh === "network") throw new Error("private content");
      return new Response(JSON.stringify(options.refresh === "missing" ? null : { ...row, effective_status: "effective" in options ? options.effective : "draft" }), { headers: { "content-type": "application/json" } });
    } },
  });
  const client: OffersWriteClient = { from: sdk.from.bind(sdk), rpc: sdk.rpc.bind(sdk), auth: { getSession: (async () => ({ data: { session: loggedIn ? { user: { id }, access_token: token } : null }, error: null })) as OffersWriteClient["auth"]["getSession"] } };
  return { repo: createOffersWriteRepository(client), requests, writes: () => requests.filter(r => r.method === "POST"), ...controls };
}
function snapshot(result: OfferWriteResult) {
  assert.equal(result.outcome, "confirmed");
  if (result.outcome !== "confirmed" || result.refresh.state !== "completed") return assert.fail("expected authoritative refresh");
  return result.refresh.value;
}

test("incomplete Draft with nullable Partner uses explicit false and database-generated UUID", async () => {
  const f = fixture(); const value = snapshot(await f.repo.save(content, { id: null, publish: false }));
  assert.equal(value.id, id); assert.equal(value.partnerId, undefined); assert.equal(value.status, "draft");
  assert.deepEqual(f.writes()[0].body, { p_id: null, p_partner_id: null, p_title: "", p_subtitle: null, p_description: "", p_publication_mode: "now", p_has_coupon: false, p_coupon: null, p_has_expiration: false, p_starts_on: null, p_expires_on: null, p_publish: false });
  assert.match(f.writes()[0].url.pathname, /save_offer$/);
});

for (const mode of ["now", "scheduled"] as const) test(`explicit ${mode} publication delegates dates and status to database`, async () => {
  const timestamp = "2026-10-09T23:30:00-03:00";
  const f = fixture({ raw: { partner_id: partnerId, published_at: timestamp, starts_on: "2026-10-10", publication_mode: mode }, effective: mode === "now" ? "active" : "scheduled" });
  const value = snapshot(await f.repo.save({ ...content, partnerId, startsOn: "2026-10-10", publicationMode: mode }, { id: null, publish: true }));
  assert.equal(value.publishedAt, timestamp); assert.equal(value.startsOn, "2026-10-10");
  assert.equal(f.writes()[0].body?.p_publish, true); assert.equal(f.writes()[0].body?.p_starts_on, "2026-10-10");
});

test("complete content never infers publication intent", async () => {
  const f = fixture({ raw: { partner_id: partnerId } });
  snapshot(await f.repo.save({ ...content, partnerId, title: "Title", description: "Description" }, { id: null, publish: false }));
  assert.equal(f.writes()[0].body?.p_publish, false);
});

test("editing Draft sends explicit UUID and allows new association", async () => {
  const f = fixture({ raw: { partner_id: partnerId } });
  assert.equal(snapshot(await f.repo.save({ ...content, partnerId }, { id, publish: false })).partnerId, partnerId);
  assert.equal(f.writes()[0].body?.p_id, id);
});

test("published edit with false preserves publication and reports ignored Partner change", async () => {
  const f = fixture({ raw: { partner_id: partnerId, published_at: "2026-10-09T12:00:00Z" }, effective: "active" });
  const result = await f.repo.save({ ...content, partnerId: otherPartner }, { id, publish: false });
  const value = snapshot(result);
  assert.equal(value.partnerId, partnerId); assert.equal(value.publishedAt, "2026-10-09T12:00:00Z");
  assert.equal(f.writes()[0].body?.p_publish, false);
  if (result.outcome === "confirmed") assert.deepEqual(result.partnerAssociation, { outcome: "preserved", partnerId });
});

test("ignored published association remains explicit even if refresh fails", async () => {
  const f = fixture({ raw: { partner_id: partnerId, published_at: "2026-10-09T12:00:00Z" }, refresh: "network" });
  const result = await f.repo.save({ ...content, partnerId: otherPartner }, { id, publish: false });
  assert.equal(result.outcome, "confirmed");
  if (result.outcome === "confirmed") { assert.equal(result.partnerAssociation?.outcome, "preserved"); assert.equal(result.refresh.state, "failed"); }
});

test("derived fields never enter save payload", async () => {
  const f = fixture(); await f.repo.save({ ...content, status: "active", publishedAt: "forbidden", deletedAt: "forbidden" } as OfferSaveContent, { id: null, publish: false });
  assert.equal(Object.keys(f.writes()[0].body!).some(key => /status|published|deleted/.test(key)), false);
});

for (const [enabled, status] of [[false, "inactive"], [true, "scheduled"], [true, "expired"]] as const) test(`enabled=${enabled} returns authoritative ${status}, never assumes active`, async () => {
  const f = fixture({ raw: { enabled, published_at: "2026-10-09T12:00:00Z" }, effective: status });
  assert.equal(snapshot(await f.repo.setEnabled(id, enabled)).status, status);
  assert.deepEqual(f.writes()[0].body, { p_id: id, p_enabled: enabled });
  assert.match(f.writes()[0].url.pathname, /set_offer_enabled$/);
});

test("scheduled activation uses only its RPC and authoritative refresh", async () => {
  const f = fixture({ raw: { starts_on: "2026-10-09" }, effective: "active" });
  assert.equal(snapshot(await f.repo.activateScheduled(id)).startsOn, "2026-10-09");
  assert.deepEqual(f.writes()[0].body, { p_id: id }); assert.match(f.writes()[0].url.pathname, /activate_scheduled_offer$/);
});

test("void acknowledgment confirms soft deletion without reading deleted row or disabling", async () => {
  const f = fixture(); const result = await f.repo.softDelete(id);
  assert.deepEqual(result, { outcome: "confirmed", operation: "delete", id, cleanup: { state: "not-needed" } });
  assert.equal(f.writes().length, 1); assert.match(f.writes()[0].url.pathname, /soft_delete_offer$/);
  assert.equal(f.requests.some(r => r.url.pathname.endsWith("offers")), false);
});

test("active deletion rejection is propagated without implicit disable", async () => {
  const f = fixture({ code: "P0001" }); await assert.rejects(f.repo.softDelete(id), fails("domain")); assert.equal(f.writes().length, 1);
});

for (const effective of [null, undefined, "unknown", "Active"]) test(`invalid effective status ${String(effective)} leaves write confirmed with failed refresh`, async () => {
  const f = fixture({ effective }); const result = await f.repo.setEnabled(id, true);
  assert.equal(result.outcome, "confirmed");
  if (result.outcome === "confirmed") { assert.equal(result.refresh.state, "failed"); if (result.refresh.state === "failed") assert.equal(result.refresh.error.kind, "response"); }
});

for (const refresh of ["network", "missing"] as const) test(`${refresh} refresh failure never reverses persistence`, async () => {
  const f = fixture({ refresh }); const result = await f.repo.activateScheduled(id);
  assert.equal(result.outcome, "confirmed"); if (result.outcome === "confirmed") assert.equal(result.refresh.state, "failed");
  assert.equal(f.writes().length, 1);
});

test("scoped refresh requests only live target and computed field", async () => {
  const f = fixture(); snapshot(await f.repo.save(content, { id: null, publish: false }));
  const read = f.requests.find(r => r.url.pathname.endsWith("offers"))!;
  assert.equal(read.url.searchParams.get("id"), `eq.${id}`); assert.equal(read.url.searchParams.get("deleted_at"), "is.null");
  assert.match(read.url.searchParams.get("select")!, /effective_status:offer_effective_status/);
});

for (const [code, kind] of [["42501", "authorization"], ["P0001", "domain"], ["23514", "domain"], ["P0002", "missing"]] as const) test(`RPC ${code} definitive rejection is ${kind} and sanitized`, async () => {
  const f = fixture({ code }); await assert.rejects(f.repo.setEnabled(id, false), error => { assert.ok(fails(kind)(error)); assert.doesNotMatch(JSON.stringify(error), /private|token/); return true; });
});

for (const auth of [{ noSession: true }, { member: false }]) test(`authorization preflight ${JSON.stringify(auth)} performs no writes`, async () => {
  const f = fixture(auth); await assert.rejects(f.repo.activateScheduled(id), fails("authorization")); assert.equal(f.writes().length, 0);
});

for (const data of [null, [], [raw, raw], { id }, { ...raw, id: "bad" }, { ...raw, id: otherPartner }]) test(`unexpected RPC result ${JSON.stringify(data)} is uncertain`, async () => {
  const f = fixture({ data }); const result = await f.repo.activateScheduled(id);
  assert.equal(result.outcome, "uncertain"); if (result.outcome === "uncertain") assert.equal(result.error.kind, "response");
});

test("object-shaped composite acknowledgment is supported without fabricated status", async () => {
  const f = fixture({ data: raw }); assert.equal(snapshot(await f.repo.activateScheduled(id)).status, "draft");
});

test("unexpected void response cannot confirm deletion", async () => {
  const f = fixture({ data: [] }); assert.equal((await f.repo.softDelete(id)).outcome, "uncertain");
});

test("abort before dispatch prevents every request", async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.repo.softDelete(id, { signal: controller.signal }), fails("cancelled")); assert.equal(f.requests.length, 0);
});

test("abort after dispatch with lost response is uncertain and not retried", async () => {
  const controller = new AbortController(); const f = fixture({ network: true, during: () => controller.abort() });
  const result = await f.repo.softDelete(id, { signal: controller.signal });
  assert.equal(result.outcome, "uncertain"); assert.equal(f.writes().length, 1);
  if (result.outcome === "uncertain") { assert.equal(result.error.kind, "uncertain"); assert.equal(result.error.retryAutomatically, false); }
});

for (const change of ["replace", "logout", "abort"] as const) test(`${change} during mutation suppresses snapshot but preserves acknowledgment`, async () => {
  const controller = new AbortController(); const f = fixture({ during: controls => change === "abort" ? controller.abort() : controls[change]() });
  const result = await f.repo.setEnabled(id, true, { signal: controller.signal });
  assert.equal(result.outcome, "confirmed"); if (result.outcome === "confirmed") { assert.equal(result.refresh.state, "failed"); if (result.refresh.state === "failed") assert.equal(result.refresh.error.kind, "stale"); }
  assert.equal(f.requests.some(r => r.url.pathname.endsWith("offers")), false);
});

test("session replacement during refresh discards late snapshot", async () => {
  const f = fixture({ duringRefresh: controls => controls.replace() }); const result = await f.repo.activateScheduled(id);
  assert.equal(result.outcome, "confirmed"); if (result.outcome === "confirmed") assert.equal(result.refresh.state, "failed");
});

test("network and gateway failures after dispatch never retry", async () => {
  for (const options of [{ network: true }, { code: "XX000", status: 503 }]) {
    const f = fixture(options); const result = await f.repo.activateScheduled(id);
    assert.equal(result.outcome, "uncertain"); assert.equal(f.writes().length, 1);
  }
});

test("explicit intent and UUID validation fail locally", () => {
  const f = fixture();
  assert.throws(() => f.repo.save(content, { id: null, publish: undefined as unknown as boolean }), fails("domain"));
  assert.throws(() => f.repo.save(content, { id: "slug", publish: false }), fails("response"));
  assert.equal(f.requests.length, 0);
});

test("migration-defined Unknown Offer is missing while other P0001 rules remain domain", async () => {
  const f = fixture({ code: "P0001", message: "Unknown Offer" });
  await assert.rejects(f.repo.softDelete(id), fails("missing"));
  const g = fixture({ code: "P0001", message: "Published Offer required" });
  await assert.rejects(g.repo.setEnabled(id, true), fails("domain"));
});
