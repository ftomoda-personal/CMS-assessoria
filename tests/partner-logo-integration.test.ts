import assert from "node:assert/strict";
import { test } from "node:test";
import { createPartnerLogoIntegration } from "../src/features/partners/partnerLogoIntegration.ts";
import type { PartnerLogoCommand } from "../src/features/partners/logoIntegrationContracts";
import type { ReadClient } from "../src/lib/supabase/readDataset";
import { MutationError, parsePersistedUuid } from "../src/lib/supabase/mutation.ts";
import type { MutationOptions } from "../src/lib/supabase/mutation";
import type { PartnerWriteResult } from "../src/features/partners/supabaseWriteRepository";
const id = parsePersistedUuid("aaaaaaaa-0000-0000-0000-000000000001");
const content = { name: "Brand", website: "brand.example" };
const file = new File(["image"], "brand.png");
function fixture() {
  let token = "initial"; let sessionId = id; let uploadError: MutationError | undefined; let dbError: Error | undefined;
  let uploadUncertain = false; let dbUncertain = false; let failedRefresh = false;
  let duringUpload = () => {}; let duringDb = () => {};
  const calls: string[] = []; const guards: unknown[] = [];
  const client = { auth: {
    getSession: async () => ({ data: { session: { access_token: token, user: { id } } }, error: null }),
    getClaims: async () => ({ data: { claims: { sub: id, session_id: sessionId } }, error: null }),
  } } as unknown as ReadClient;
  const write = async (kind: string, options?: MutationOptions): Promise<PartnerWriteResult> => {
    calls.push(kind); guards.push(options?.sessionGuard); duringDb();
    if (dbError) throw dbError;
    if (dbUncertain) return { outcome: "uncertain", id, error: new MutationError("uncertain") };
    return { outcome: "confirmed", operation: "persist", id, refresh: failedRefresh ? { state: "failed", error: new MutationError("response") } : { state: "not-needed" }, cleanup: { state: "not-needed" } };
  };
  const service = createPartnerLogoIntegration({ client, logos: { upload: async (_file, options) => {
    calls.push("upload"); guards.push(options?.sessionGuard); duringUpload();
    if (uploadError) throw uploadError;
    const metadata = { bucket: "partner-logos" as const, objectPath: `logos/${id}.png`, originalFilename: file.name };
    return uploadUncertain ? { ...metadata, outcome: "uncertain", error: new MutationError("uncertain") } : { ...metadata, outcome: "confirmed", canApply: true };
  } }, partners: {
    create: (_c, o) => write("create", o), createWithLogo: (_c, _p, o) => write("create-logo", o),
    update: (_id, _c, o) => write("keep", o), updateWithLogo: (_id, _c, _e, p, o) => write(p ? "replace" : "remove", o),
  } });
  const command = (kind: "create" | "edit", logo: "none" | "keep" | "remove" | "replace", existing = false): PartnerLogoCommand => ({ kind,
    context: { operationId: id, initiatingAdminId: id, target: kind === "create" ? { kind: "create" } : { kind: "edit", id, expectedLogo: { logo_path: existing ? "legacy.png" : null, logo_name: null } } },
    content, logo: logo === "replace" ? { kind: logo, file } : { kind: logo },
  }) as PartnerLogoCommand;
  return { service, command, calls, guards, reject: (e?: Error) => { dbError = e; }, uploadFail: () => { uploadError = new MutationError("domain"); }, uncertainUpload: () => { uploadUncertain = true; }, uncertainDb: () => { dbUncertain = true; }, refreshFail: () => { failedRefresh = true; }, uploadHook: (fn: () => void) => { duringUpload = fn; }, dbHook: (fn: () => void) => { duringDb = fn; }, refresh: () => { token = "refreshed"; }, login: () => { token = "new-login"; sessionId = parsePersistedUuid("bbbbbbbb-0000-0000-0000-000000000002"); } };
}
for (const [kind, logo, expected, existing] of [
  ["create", "none", ["create"], false], ["create", "replace", ["upload", "create-logo"], false],
  ["edit", "keep", ["keep"], true], ["edit", "replace", ["upload", "replace"], false],
  ["edit", "replace", ["upload", "replace"], true], ["edit", "remove", ["remove"], true],
] as const) test(`${kind} ${logo} existing=${existing}`, async () => {
  const f = fixture(); assert.equal((await f.service.execute(f.command(kind, logo, existing))).kind, "confirmed");
  assert.deepEqual(f.calls, expected); assert.ok(f.guards.every(g => g === f.guards[0]));
});
for (const mode of ["failure", "uncertain"] as const) test(`upload ${mode} stops DB`, async () => {
  const f = fixture(); if (mode === "failure") f.uploadFail(); else f.uncertainUpload();
  const result = await f.service.execute(f.command("create", "replace"));
  assert.equal(result.kind, mode === "failure" ? "before-database-failure" : "upload-uncertain"); assert.deepEqual(f.calls, ["upload"]);
  assert.ok(result.reconciliation.uploaded || mode === "failure");
});
for (const mode of ["reject", "uncertain", "conflict", "unexpected"] as const) test(`DB ${mode} preserves objects and never retries`, async () => {
  const f = fixture(); if (mode === "uncertain") f.uncertainDb(); else f.reject(mode === "unexpected" ? new Error("transport") : new MutationError(mode === "conflict" ? "conflict" : "domain"));
  const result = await f.service.execute(f.command("edit", "replace", true));
  assert.equal(result.kind, mode === "reject" || mode === "conflict" ? "before-database-failure" : "database-uncertain");
  assert.equal(result.objects, "preserve"); assert.deepEqual(f.calls, ["upload", "replace"]);
});
test("refresh token between steps retains shared session", async () => {
  const f = fixture(); f.uploadHook(f.refresh); assert.equal((await f.service.execute(f.command("create", "replace"))).kind, "confirmed");
});
test("new login by same admin prevents DB attachment", async () => {
  const f = fixture(); f.uploadHook(f.login); const result = await f.service.execute(f.command("create", "replace"));
  assert.equal(result.kind, "interrupted"); assert.equal(result.reconciliation.uploaded?.state, "confirmed"); assert.deepEqual(f.calls, ["upload"]);
});
for (const timing of ["before", "upload", "database"] as const) test(`cancel ${timing}`, async () => {
  const f = fixture(); const controller = new AbortController();
  if (timing === "before") controller.abort();
  if (timing === "upload") f.uploadHook(() => controller.abort());
  if (timing === "database") { f.dbHook(() => controller.abort()); f.uncertainDb(); }
  assert.equal((await f.service.execute(f.command("create", "replace"), { signal: controller.signal })).kind, timing === "database" ? "database-uncertain" : "interrupted");
  assert.equal(f.calls.length, timing === "before" ? 0 : timing === "upload" ? 1 : 2);
});
test("plain or fabricated database errors cannot authorize retry", async () => {
  const f = fixture(); f.reject(new MutationError("domain", "23514", 400));
  const after = await f.service.execute(f.command("create", "replace"));
  assert.equal(after.kind, "before-database-failure");
  await assert.rejects(f.service.retry({ kind: "retry-prepared", after: after as never, content }));
});
test("confirmed persistence survives refresh failure", async () => {
  const f = fixture(); f.refreshFail(); const result = await f.service.execute(f.command("create", "replace"));
  assert.equal(result.kind, "confirmed"); if (result.kind === "confirmed") assert.equal(result.persistence.refresh.state, "failed");
});
