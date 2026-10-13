import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createPartnersWriteRepository, getPartnerWriteFailureEvidence } from "../src/features/partners/supabaseWriteRepository.ts";
import { createPartnerLogoRepository } from "../src/features/partners/supabaseLogoRepository.ts";
import { createPartnerLogoIntegration } from "../src/features/partners/partnerLogoIntegration.ts";
import type { PartnerLogoCommand, PartnerLogoIntegrationOutcome } from "../src/features/partners/logoIntegrationContracts";
import type { LogoMetadataReference } from "../src/features/partners/logoIntegrationContracts";
import type { ReadClient } from "../src/lib/supabase/readDataset";
import { parsePersistedUuid } from "../src/lib/supabase/mutation.ts";
const id = parsePersistedUuid("aaaaaaaa-0000-0000-0000-000000000001");
const path = "logos/bbbbbbbb-0000-0000-0000-000000000002.png";
const empty = { logo_path: null, logo_name: null };
const old = { logo_path: "legacy.png", logo_name: "Old" };
const content = { name: "Updated", website: "updated.example" };
const file = new File([new Uint8Array([137,80,78,71,13,10,26,10])], "new.png", { type: "image/png" });
function command(kind: "create" | "edit" = "edit", intent: "replace" | "keep" | "remove" | "none" = "replace"): PartnerLogoCommand {
  return { kind, context: { operationId: id, initiatingAdminId: id, target: kind === "create" ? { kind: "create" } : { kind: "edit", id, expectedLogo: old } }, content, logo: intent === "replace" ? { kind: intent, file } : { kind: intent } } as PartnerLogoCommand;
}
async function cannotRetry(f: ReturnType<typeof fixture>, after: PartnerLogoIntegrationOutcome) {
  await assert.rejects(f.service.retry({ kind: "retry-prepared", after: after as never, content }));
}
function fixture(options: { initial?: LogoMetadataReference; zero?: boolean; missing?: boolean; concurrent?: LogoMetadataReference;
  code?: string; status?: number; network?: boolean; refreshError?: boolean; member?: boolean; wrongUser?: boolean;
  during?: (f: { replace(): void; logout(): void }) => void;
} = {}) {
  const sessionId: string = "ffffffff-0000-0000-0000-000000000001"; let member = true; let rejection: { code: string; status: number } | undefined; let uncertain = false; let zero = false; let refreshError = false;
  let token = "test-token"; let loggedIn = true;
  let stored = { id, name: "Brand", website: "brand.example", ever_associated: false, ...(options.initial ?? empty) };
  const requests: { method: string; url: URL; body?: Record<string, unknown> }[] = [];
  const controls = { replace: () => { token = "new-token"; }, logout: () => { loggedIn = false; } };
  const sdk = createClient("https://test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); const method = init?.method ?? "GET";
      const body = init?.body && !url.pathname.includes("/storage/") ? JSON.parse(String(init.body)) : undefined; requests.push({ url, method, body });
      const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
      if (url.pathname.includes("/storage/")) return respond({ Id: id, Key: `partner-logos/${path}` });
      if (url.pathname.endsWith("cms_admins")) return respond(!member || options.member === false ? null : { user_id: options.wrongUser ? "dddddddd-0000-0000-0000-000000000004" : id });
      assert.equal(url.pathname, "/rest/v1/partners");
      if (method === "GET") return respond(refreshError || options.refreshError ? { code: "42501", message: "private" } : options.missing ? null : stored, refreshError || options.refreshError ? 403 : 200);
      assert.ok(method === "PATCH" || method === "POST"); options.during?.(controls);
      if (uncertain || options.network) throw new Error("private-token");
      if (rejection) return respond({ code: rejection.code }, rejection.status);
      if (options.code) return respond({ code: options.code, message: "private" }, options.status ?? 400);
      if (options.concurrent) stored = { ...stored, ...options.concurrent };
      const matches = (["logo_path", "logo_name"] as const).every(field => {
        const filter = url.searchParams.get(field);
        return !filter || filter === (stored[field] === null ? "is.null" : `eq.${stored[field]}`);
      });
      if (zero || options.zero || !matches) return respond([]);
      stored = { ...stored, ...body }; return respond([{ id }]);
    } },
  });
  const client: ReadClient = { from: sdk.from.bind(sdk), auth: { getClaims: (async (_jwt: string) => ({ data: { claims: { sub: options.wrongUser ? "dddddddd-0000-0000-0000-000000000004" : id, session_id: token === "new-token" ? "eeeeeeee-0000-0000-0000-000000000001" : sessionId } }, error: null })) as NonNullable<ReadClient["auth"]["getClaims"]>, getSession: (async () => ({ data: { session: loggedIn ? { user: { id: options.wrongUser ? "dddddddd-0000-0000-0000-000000000004" : id }, access_token: token } : null }, error: null })) as ReadClient["auth"]["getSession"] } };
  const repo = createPartnersWriteRepository(client);
  let uploadCalls = 0;
  const logo = createPartnerLogoRepository({ ...client, storage: sdk.storage }, { randomUUID: () => "bbbbbbbb-0000-0000-0000-000000000002" });
  const service = createPartnerLogoIntegration({ client, partners: repo, logos: { upload: async (file, o) => { const result = await logo.upload(file, o); uploadCalls++; uploadHook(); return result; } } });
  let uploadHook = () => {};
  return { repo, service, requests, stored: () => stored, uploads: () => uploadCalls,
    writes: () => requests.filter(r => r.method === "PATCH" || r.method === "POST" && r.url.pathname.endsWith("partners")),
    reject: (code?: string, status = 400) => { rejection = code ? { code, status } : undefined; },
    membership: (value: boolean) => { member = value; }, logout: () => { loggedIn = false; }, refresh: () => { token = "refreshed-token"; }, login: () => { token = "new-token"; },
    uploadHook: (fn: () => void) => { uploadHook = fn; }, uncertain: () => { uncertain = true; }, zero: () => { zero = true; }, refreshFail: () => { refreshError = true; },
    concurrent: () => { stored = { ...stored, logo_path: "concurrent.png", logo_name: "Concurrent" }; },
  };
}

for (const failure of ["membership", "authentication"] as const) test(`${failure} preflight after upload grants no retry`, async () => {
  const f = fixture({ initial: old }); f.uploadHook(() => failure === "membership" ? f.membership(false) : f.logout());
  const after = await f.service.execute(command());
  assert.equal(after.kind, failure === "membership" ? "before-database-failure" : "interrupted");
  assert.equal(after.reconciliation.uploaded?.state, "confirmed"); assert.equal(f.writes().length, 0);
  await cannotRetry(f, after);
});
test("authentication failure before operation dispatch grants no retry", async () => {
  const f = fixture(); f.logout(); const after = await f.service.execute(command("create"));
  assert.equal(after.kind, "before-database-failure"); assert.equal(f.uploads(), 0); await cannotRetry(f, after);
});
test("eligible rejection, token refresh and single-use manual retry reuse confirmed Storage object", async () => {
  const f = fixture({ initial: old }); f.reject("23514"); const after = await f.service.execute(command());
  assert.equal(after.kind, "upload-confirmed-database-rejected"); if (after.kind !== "upload-confirmed-database-rejected") return;
  assert.equal(getPartnerWriteFailureEvidence(after.error)?.state, "database-rejected");
  await cannotRetry(f, JSON.parse(JSON.stringify(after))); f.refresh(); f.reject();
  assert.equal((await f.service.retry({ kind: "retry-prepared", after, content })).kind, "confirmed");
  assert.equal(f.uploads(), 1); assert.equal(f.writes().length, 2); await cannotRetry(f, after);
});
for (const code of ["42501", "23505", "40001", "40P01", "P0001", "XX000"]) test(`definitive ${code} is ineligible and not a logo conflict`, async () => {
  const f = fixture({ initial: old }); f.reject(code, code === "42501" ? 403 : 400);
  const after = await f.service.execute(command()); assert.equal(after.kind, "database-rejected"); await cannotRetry(f, after);
  assert.equal(f.stored().name, "Brand"); assert.equal(f.stored().logo_path, old.logo_path);
});
test("uncertain dispatched mutation grants no retry", async () => {
  const f = fixture({ initial: old }); f.uncertain(); const after = await f.service.execute(command());
  assert.equal(after.kind, "database-uncertain"); assert.equal(f.writes().length, 1); await cannotRetry(f, after);
});
test("proven logo conflict preserves all content and requires new decision", async () => {
  const f = fixture({ initial: old }); f.uploadHook(f.concurrent); const after = await f.service.execute(command());
  assert.equal(after.kind, "logo-conflict"); assert.equal(f.stored().name, "Brand"); assert.equal(f.stored().website, "brand.example");
  assert.equal(f.stored().logo_path, "concurrent.png"); assert.equal(f.stored().logo_name, "Concurrent"); await cannotRetry(f, after);
});
for (const failedRead of [false, true]) test(`zero-row without conflict evidence failedRead=${failedRead} grants no retry`, async () => {
  const f = fixture({ initial: old }); f.zero(); if (failedRead) f.refreshFail();
  const after = await f.service.execute(command()); assert.equal(after.kind, "zero-row"); await cannotRetry(f, after);
});
for (const [kind, intent] of [["create", "none"], ["edit", "keep"], ["edit", "remove"]] as const) test(`${kind} ${intent} rejection is database failure`, async () => {
  const f = fixture({ initial: old }); f.reject("23514"); const after = await f.service.execute(command(kind, intent));
  assert.equal(after.kind, "database-rejected"); assert.equal(f.uploads(), 0); assert.equal(f.writes().length, 1); await cannotRetry(f, after);
});
for (const change of ["metadata", "login"] as const) test(`retry after changed ${change} cannot persist`, async () => {
  const f = fixture({ initial: old }); f.reject("23514"); const after = await f.service.execute(command());
  assert.equal(after.kind, "upload-confirmed-database-rejected"); if (after.kind !== "upload-confirmed-database-rejected") return;
  f.reject(); if (change === "metadata") f.concurrent(); else f.login();
  const result = await f.service.retry({ kind: "retry-prepared", after, content });
  assert.equal(result.kind, change === "metadata" ? "logo-conflict" : "interrupted"); assert.equal(f.uploads(), 1);
  assert.equal(f.stored().name, "Brand"); await cannotRetry(f, result); await cannotRetry(f, after);
});
test("confirmed database write with refresh failure remains confirmed", async () => {
  const f = fixture({ initial: old }); f.refreshFail(); const after = await f.service.execute(command());
  assert.equal(after.kind, "confirmed"); if (after.kind === "confirmed") assert.equal(after.persistence.refresh.state, "failed");
});

for (const status of [200, 302, 500, 503]) test(`ambiguous/server error status ${status} never proves rejection`, async () => {
  const f = fixture({ initial: old }); f.reject("23514", status); const after = await f.service.execute(command());
  assert.equal(after.kind, "database-uncertain"); await cannotRetry(f, after);
});
test("session changes during rejected write prevent authorization issuance", async () => {
  const f = fixture({ initial: old, during: controls => controls.replace() }); f.reject("23514");
  const after = await f.service.execute(command()); assert.equal(after.kind, "interrupted"); await cannotRetry(f, after);
});
