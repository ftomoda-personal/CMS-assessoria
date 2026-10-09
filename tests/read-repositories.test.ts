import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { ReadClient } from "../src/lib/supabase/readDataset.ts";
import { ReadRepositoryError } from "../src/lib/supabase/readDataset.ts";
import { createPartnersReadRepository } from "../src/features/partners/supabaseReadRepository.ts";
import { createOffersReadRepository } from "../src/features/offers/supabaseReadRepository.ts";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const partner = (n: number, name = `Partner ${n}`) => ({ id: id(n), name, website: "brand.example", logo_path: null as string | null, logo_name: null as string | null, ever_associated: false });
const offer = (n: number) => ({ id: id(n), partner_id: null, title: "Title", subtitle: null, description: "", publication_mode: "now", has_coupon: false, coupon: null, has_expiration: false, starts_on: null, expires_on: null, published_at: null, enabled: true, deleted_at: null as string | null, effective_status: "draft" as string | null });

type ResponseSpec = { data?: unknown; count?: number | null; status?: number; code?: string };
function fixture(dataset: unknown[], options: {
  cap?: number; member?: boolean; noSession?: boolean;
  respond?: (url: URL, page: number) => ResponseSpec | undefined | Promise<ResponseSpec | undefined>;
} = {}) {
  let token = "test-token";
  let pages = 0;
  let memberships = 0;
  const requests: URL[] = [];
  const session = () => options.noSession ? null : ({ user: { id: id(99) }, access_token: token });
  const sdk = createClient("https://test.invalid", "test-publishable", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname.endsWith("cms_admins")) {
        memberships++;
        return new Response(JSON.stringify(options.member === false ? null : { user_id: id(99) }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const head = init?.method === "HEAD";
      const result = await options.respond?.(url, head ? -1 : pages++);
      if (result?.code) return new Response(JSON.stringify({ code: result.code, message: "private", details: "private" }), { status: result.status ?? 400, headers: { "content-type": "application/json" } });
      const cursor = url.searchParams.get("id")?.slice(3);
      const remaining = (dataset as { id: string }[]).filter(row => !cursor || row.id > cursor);
      const data = result && "data" in result ? result.data : remaining.slice(0, options.cap ?? 500);
      const count = result && "count" in result ? result.count : remaining.length;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (count !== null) headers["content-range"] = `0-0/${count}`;
      return new Response(head ? null : JSON.stringify(data), { status: 200, headers });
    } },
  });
  const client: ReadClient = {
    from: sdk.from.bind(sdk),
    auth: { getSession: (async () => ({ data: { session: session() }, error: null })) as ReadClient["auth"]["getSession"] },
  };
  return { client, requests, changeSession: () => { token = "new-test-token"; }, memberships: () => memberships };
}
const fails = (kind: string) => (error: unknown) => error instanceof ReadRepositoryError && error.kind === kind;

test("Partners maps logo/history and sorts pt-BR with UUID tie-break", async () => {
  const f = fixture([partner(1, "zebra"), { ...partner(2, "Árvore"), logo_path: "logos/a.png", logo_name: "original.png", ever_associated: true }, partner(3, "arvore")]);
  const rows = await createPartnersReadRepository(f.client).readAll();
  assert.deepEqual(rows.map(row => row.id), [id(2), id(3), id(1)]);
  assert.equal(rows[0].everAssociated, true);
  assert.equal(rows[0].logo?.objectPath, "logos/a.png");
  assert.equal(rows[0].logoUrl, undefined);
  assert.equal(f.memberships(), 2);
});

test("Offers selects authoritative projection and excludes deleted rows defensively", async () => {
  const statuses = ["draft", "active", "inactive", "scheduled", "expired"];
  const dataset = statuses.map((status, n) => ({ ...offer(n + 1), effective_status: status, starts_on: "2026-10-08", published_at: "2026-10-08T23:30:00-03:00" }));
  const f = fixture([...dataset, { ...offer(6), deleted_at: "2026-10-08T23:30:00Z", effective_status: null }]);
  const rows = await createOffersReadRepository(f.client).readAll();
  assert.deepEqual(rows.map(row => row.status), statuses);
  assert.equal(rows[0].partnerId, undefined);
  assert.equal(rows[0].startsOn, "2026-10-08");
  assert.equal(rows[0].publishedAt, "2026-10-08T23:30:00-03:00");
  const query = f.requests.find(url => url.pathname.endsWith("offers"));
  assert.equal(query?.searchParams.get("deleted_at"), "is.null");
  assert.ok(query?.searchParams.get("select")?.includes("effective_status:offer_effective_status"));
});

for (const module of ["partners", "offers"] as const) {
  test(`${module}: empty is a successful complete result`, async () => {
    const f = fixture([]);
    const repo = module === "partners" ? createPartnersReadRepository(f.client) : createOffersReadRepository(f.client);
    assert.deepEqual(await repo.readAll(), []);
  });
  test(`${module}: paginates 1201 rows despite API cap below requested size`, async () => {
    const f = fixture(Array.from({ length: 1201 }, (_, n) => module === "partners" ? partner(n + 1) : offer(n + 1)), { cap: 100 });
    const repo = module === "partners" ? createPartnersReadRepository(f.client) : createOffersReadRepository(f.client);
    assert.equal((await repo.readAll()).length, 1201);
    const pages = f.requests.filter(url => url.pathname.endsWith(module) && url.searchParams.has("limit"));
    assert.equal(pages.length, 13);
    assert.ok(pages.every(url => url.searchParams.get("order") === "id.asc"));
    assert.equal(pages[1].searchParams.get("id"), `gt.${id(100)}`);
  });
}

test("No session and nonmember fail authorization before dataset request", async () => {
  for (const options of [{ noSession: true }, { member: false }]) {
    const f = fixture([], options);
    await assert.rejects(createPartnersReadRepository(f.client).readAll(), fails("authorization"));
    assert.equal(f.requests.some(url => url.pathname.endsWith("partners")), false);
  }
});

for (const [code, status, kind] of [["42501", 403, "authorization"], ["PGRST204", 400, "query"], ["XX000", 500, "query"]] as const) {
  test(`Explicit ${kind} error ${code} is propagated without raw details`, async () => {
    const f = fixture([], { respond: () => ({ code, status }) });
    await assert.rejects(createOffersReadRepository(f.client).readAll(), error => {
      assert.ok(error instanceof ReadRepositoryError);
      assert.equal(error.kind, kind);
      assert.equal(error.code, code);
      assert.equal(error.httpStatus, status);
      assert.ok(!error.message.includes("private"));
      return true;
    });
  });
}

test("Intermediate-page error rejects rather than returning partial rows", async () => {
  const f = fixture([partner(1), partner(2)], { cap: 1, respond: (_url, page) => page === 1 ? { code: "XX000", status: 500 } : undefined });
  await assert.rejects(createPartnersReadRepository(f.client).readAll(), fails("query"));
});

for (const value of ["invalid", null, undefined]) {
  test(`Rejects live Offer status ${String(value)}`, async () => {
    const f = fixture([{ ...offer(1), effective_status: value }]);
    await assert.rejects(createOffersReadRepository(f.client).readAll(), fails("mapping"));
  });
}

for (const [name, response, kind] of [
  ["missing count", { count: null }, "response"],
  ["null payload", { data: null }, "response"],
  ["truncated page", { data: [], count: 2 }, "incomplete"],
  ["duplicate IDs", { data: [partner(1), partner(1)], count: 2 }, "incomplete"],
  ["invalid row", { data: [{ id: id(1) }], count: 1 }, "mapping"],
] as const) {
  test(`Rejects ${name}`, async () => {
    const f = fixture([partner(1)], { respond: () => response });
    await assert.rejects(createPartnersReadRepository(f.client).readAll(), fails(kind));
  });
}

test("Changing counts mid-pagination or at final check fails completeness", async () => {
  for (const page of [1, -1]) {
    const f = fixture([partner(1), partner(2)], { cap: 1, respond: (_url, index) => index === page ? { count: 3 } : undefined });
    await assert.rejects(createPartnersReadRepository(f.client).readAll(), fails("incomplete"));
  }
});

test("Already aborted requests perform no reads", async () => {
  const controller = new AbortController(); controller.abort();
  const f = fixture([]);
  await assert.rejects(createPartnersReadRepository(f.client).readAll({ signal: controller.signal }), fails("cancelled"));
  assert.equal(f.requests.length, 0);
});

test("Cancellation and session change discard late successful responses", async () => {
  for (const mode of ["cancel", "session"] as const) {
    const controller = new AbortController();
    let release!: () => void;
    let started!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    const f = fixture([partner(1)], { respond: async (_url, page) => { if (page === 0) { started(); await wait; } return undefined; } });
    const result = createPartnersReadRepository(f.client).readAll({ signal: controller.signal });
    await ready;
    if (mode === "cancel") controller.abort(); else f.changeSession();
    release();
    await assert.rejects(result, fails(mode === "cancel" ? "cancelled" : "stale"));
  }
});

test("Admin revocation during a load prevents an apparently empty/successful result", async () => {
  const options: Parameters<typeof fixture>[1] = {};
  options.respond = () => { options.member = false; return undefined; };
  const f = fixture([partner(1)], options);
  await assert.rejects(createPartnersReadRepository(f.client).readAll(), fails("authorization"));
});

test("Malformed UUID and invalid Partner logo pair are rejected", async () => {
  const invalidId = fixture([{ ...partner(1), id: "not-a-uuid" }]);
  await assert.rejects(createPartnersReadRepository(invalidId.client).readAll(), fails("response"));
  const invalidLogo = fixture([{ ...partner(1), logo_name: "orphan.png" }]);
  await assert.rejects(createPartnersReadRepository(invalidLogo.client).readAll(), fails("mapping"));
});

test("Network failure becomes an explicit query error", async () => {
  const f = fixture([], { respond: () => { throw new Error("private network details"); } });
  await assert.rejects(createOffersReadRepository(f.client).readAll(), fails("query"));
});
