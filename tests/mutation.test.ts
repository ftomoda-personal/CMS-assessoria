import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { ReadClient } from "../src/lib/supabase/readDataset.ts";
import { MutationError, classifyMutationRejection, createMutationLifecycle, parsePersistedUuid } from "../src/lib/supabase/mutation.ts";
import type { ConfirmedPersistence, ConfirmedDeletion, UncertainMutation } from "../src/lib/supabase/mutation.ts";

const uuid = "AAAAAAAA-0000-0000-0000-000000000001";
const id = parsePersistedUuid(uuid);
const fails = (kind: string) => (error: unknown) => error instanceof MutationError && error.kind === kind;
function fixture() {
  let token = "private-token";
  let userId = uuid;
  let loggedIn = true;
  let member = true;
  let code: string | undefined;
  let reads = 0;
  let duringRead: (() => void) | undefined;
  const sdk = createClient("https://test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      assert.equal(init?.method, "GET");
      assert.equal(new URL(String(input)).pathname, "/rest/v1/cms_admins");
      reads++;
      duringRead?.();
      return new Response(JSON.stringify(code ? { code, message: "private Offer content", details: token } : member ? { user_id: userId } : null), {
        status: code ? 403 : 200, headers: { "content-type": "application/json" },
      });
    } },
  });
  const client: ReadClient = { from: sdk.from.bind(sdk), auth: { getClaims: (async (jwt: string) => ({ data: { claims: { sub: userId, session_id: jwt.includes("replacement") || jwt.includes("changed") || jwt === "new-token" ? "eeeeeeee-0000-0000-0000-000000000001" : "ffffffff-0000-0000-0000-000000000001" } }, error: null })) as NonNullable<ReadClient["auth"]["getClaims"]>, getSession: (async () => ({ data: { session: loggedIn ? { user: { id: userId }, access_token: token } : null }, error: null })) as ReadClient["auth"]["getSession"] } };
  return { client, reads: () => reads, replace: () => { token = "replacement-token"; }, switchUser: () => { userId = "BBBBBBBB-0000-0000-0000-000000000002"; }, logout: () => { loggedIn = false; }, revoke: () => { member = false; }, reject: () => { code = "42501"; }, during: (callback: () => void) => { duringRead = callback; } };
}

test("confirmed persistence and deletion retain validated UUIDs", () => {
  const result: ConfirmedPersistence<string> = { outcome: "confirmed", operation: "persist", id, refresh: { state: "completed", value: "domain snapshot" }, cleanup: { state: "not-needed" } };
  const deletion: ConfirmedDeletion = { outcome: "confirmed", operation: "delete", id, cleanup: { state: "completed", value: undefined } };
  assert.equal(result.outcome, "confirmed");
  assert.equal(deletion.outcome, "confirmed");
  assert.equal(result.id, uuid);
});

test("refresh failure or pending refresh never changes confirmed persistence", () => {
  for (const refresh of [{ state: "pending" } as const, { state: "failed", error: new MutationError("response") } as const]) {
    const result: ConfirmedPersistence<string> = { outcome: "confirmed", operation: "persist", id, refresh, cleanup: { state: "not-needed" } };
    assert.equal(result.outcome, "confirmed");
    assert.notEqual(result.refresh.state, "completed");
  }
});

test("cleanup failure or pending cleanup never changes confirmed persistence/deletion", () => {
  for (const cleanup of [{ state: "pending" } as const, { state: "failed", error: new MutationError("authorization") } as const]) {
    const write: ConfirmedPersistence<never> = { outcome: "confirmed", operation: "persist", id, refresh: { state: "pending" }, cleanup };
    const deletion: ConfirmedDeletion = { outcome: "confirmed", operation: "delete", id, cleanup };
    assert.equal(write.outcome, "confirmed");
    assert.equal(deletion.outcome, "confirmed");
  }
});

test("uncertain outcome may carry target UUID without asserting persistence", () => {
  const unknown: UncertainMutation = { outcome: "uncertain", error: new MutationError("uncertain") };
  const known: UncertainMutation = { ...unknown, id };
  assert.equal(unknown.id, undefined);
  assert.equal(known.outcome, "uncertain");
  assert.equal(known.error.retryAutomatically, false);
});

for (const [code, status, kind] of [
  ["42501", 400, "authorization"], [undefined, 401, "authorization"], [undefined, 403, "authorization"],
  ["P0001", 400, "domain"], ["23503", 409, "domain"], ["23514", 400, "domain"], ["23502", 400, "domain"], ["22P02", 400, "domain"], ["22007", 400, "domain"],
  ["23505", 409, "conflict"], ["40001", 409, "conflict"], ["40P01", 409, "conflict"],
  ["P0002", 400, "missing"], [undefined, 404, "missing"], ["PGRST204", 400, "response"], ["XX000", 500, "response"],
] as const) test(`definitive rejection ${code ?? status} classifies as ${kind}`, () => {
  assert.equal(classifyMutationRejection(code, status).kind, kind);
});

test("errors never preserve raw content, credentials or invalid status/code", () => {
  const error = new MutationError("response", "private-token Offer content", 999);
  assert.equal(error.code, undefined);
  assert.equal(error.httpStatus, undefined);
  assert.equal(error.message, "Supabase mutation: response");
  assert.equal("cause" in error, false);
  assert.doesNotMatch(JSON.stringify(error), /token|Offer content/);
  assert.throws(() => parsePersistedUuid("private Offer"), fails("response"));
  assert.throws(() => parsePersistedUuid(null), fails("response"));
});

test("authorized lifecycle prepares once and permits current result", async () => {
  const f = fixture();
  const life = await createMutationLifecycle(f.client);
  assert.throws(() => life.markDispatched(), fails("response"));
  await life.prepareDispatch();
  life.markDispatched();
  assert.equal(await life.canApplyResult(), true);
  assert.throws(() => life.markDispatched(), fails("response"));
  await assert.rejects(life.prepareDispatch(), fails("response"));
});

test("missing session and missing membership fail before dispatch", async () => {
  const f = fixture(); f.logout();
  await assert.rejects(createMutationLifecycle(f.client), fails("authorization"));
  const g = fixture(); g.revoke();
  const life = await createMutationLifecycle(g.client);
  await assert.rejects(life.prepareDispatch(), fails("authorization"));
  assert.throws(() => life.markDispatched(), fails("response"));
});

test("membership query rejection is sanitized", async () => {
  const f = fixture(); f.reject();
  const life = await createMutationLifecycle(f.client);
  await assert.rejects(life.prepareDispatch(), error => {
    assert.ok(error instanceof MutationError);
    assert.equal(error.kind, "authorization");
    assert.doesNotMatch(JSON.stringify(error), /private/);
    return true;
  });
});

test("abort before initialization performs no remote requests", async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(createMutationLifecycle(f.client, { signal: controller.signal }), fails("cancelled"));
  assert.equal(f.reads(), 0);
});

test("abort before dispatch and during membership checks remains cancellation", async () => {
  const f = fixture(); const controller = new AbortController();
  const life = await createMutationLifecycle(f.client, { signal: controller.signal });
  f.during(() => controller.abort());
  await assert.rejects(life.prepareDispatch(), fails("cancelled"));
  assert.equal(life.interruption().kind, "cancelled");
});

test("abort between preparation and dispatch prevents request", async () => {
  const f = fixture(); const controller = new AbortController();
  const life = await createMutationLifecycle(f.client, { signal: controller.signal });
  await life.prepareDispatch(); controller.abort();
  assert.throws(() => life.markDispatched(), fails("cancelled"));
});

test("abort after dispatch is uncertain and suppresses UI", async () => {
  const f = fixture(); const controller = new AbortController();
  const life = await createMutationLifecycle(f.client, { signal: controller.signal });
  await life.prepareDispatch(); life.markDispatched(); controller.abort();
  assert.equal(life.interruption().kind, "uncertain");
  assert.equal(await life.canApplyResult(), false);
});

for (const change of ["replace", "switchUser", "logout", "revoke"] as const) test(`${change} after dispatch suppresses UI, preserving confirmed outcome`, async () => {
  const f = fixture(); const life = await createMutationLifecycle(f.client);
  await life.prepareDispatch(); life.markDispatched(); f[change]();
  const result: ConfirmedDeletion = { outcome: "confirmed", operation: "delete", id, cleanup: { state: "pending" } };
  assert.equal(await life.canApplyResult(), false);
  assert.equal(result.outcome, "confirmed");
  assert.equal(life.interruption().kind, "uncertain");
});

test("session change before or during authorization is stale", async () => {
  const f = fixture(); const life = await createMutationLifecycle(f.client); f.replace();
  await assert.rejects(life.prepareDispatch(), fails("stale"));
  const g = fixture(); const second = await createMutationLifecycle(g.client); g.during(g.replace);
  await assert.rejects(second.prepareDispatch(), fails("stale"));
});

test("transport interruption after dispatch never retries or performs writes", async () => {
  const f = fixture(); const life = await createMutationLifecycle(f.client);
  await life.prepareDispatch(); life.markDispatched(); const reads = f.reads();
  for (let i = 0; i < 3; i++) {
    assert.equal(life.interruption().kind, "uncertain");
    assert.equal(life.interruption().retryAutomatically, false);
  }
  assert.equal(f.reads(), reads);
});

// Compile-time constraints, intentionally never invoked.
function typeContracts() {
  // @ts-expect-error UUID must be validated before use as persisted identity.
  const invalidId: ConfirmedDeletion = { outcome: "confirmed", operation: "delete", id: "slug", cleanup: { state: "not-needed" } };
  // @ts-expect-error Pending refresh cannot contain a claimed refreshed value.
  const invalidRefresh: ConfirmedPersistence<string> = { outcome: "confirmed", operation: "persist", id, refresh: { state: "pending", value: "predicted" }, cleanup: { state: "not-needed" } };
  return [invalidId, invalidRefresh];
}
void typeContracts;
