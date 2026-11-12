import { createAdministrativeOperationAuthority } from '../server/cms/administrativeOperationAuthority.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCurrentAccountService } from '../server/cms/currentAccount.ts';
import { createCmsHandler } from '../server/cms/handler.ts';
import type { ExplicitTokenAuth } from '../server/cms/supabaseAccountAuthority.ts';
const actor = '10000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
const token = 'e30.e30.c2ln';
const headers = [['Authorization', `Bearer ${token}`]] as const;
const admin = () => ({ account: { user_id: actor, role: 'administrator', status: 'active' }, membership: { user_id: actor } });
function fixture(options: { snapshot?: unknown; dbFailure?: boolean; claims?: Record<string, unknown>;
  authError?: { status: number }; identity?: string; hang?: boolean } = {}) {
  let reads = 0; let claimsCalls = 0; let userCalls = 0;
  let snapshot: unknown = Object.hasOwn(options, 'snapshot') ? options.snapshot : admin();
  let release: (value: unknown) => void = () => {};
  const service = createCurrentAccountService({ issuer: 'https://auth.synthetic.invalid/auth/v1', audience: 'authenticated',
    deadlineMs: options.hang ? 10 : 1000, nowSeconds: () => 1000,
    createAuth: () => ({
      async getClaims(received: string, settings: unknown) {
        claimsCalls++;assert.equal(received, token);assert.deepEqual(settings, { allowExpired: false });
        return { error: options.authError ?? null, data: { claims: { sub: actor, iss: 'https://auth.synthetic.invalid/auth/v1', aud: 'authenticated', exp: 1100, ...options.claims } } };
      },
      async getUser(received: string) {userCalls++;assert.equal(received, token);return { error: null, data: { user: { id: options.identity ?? actor } } };},
    } as unknown as ExplicitTokenAuth),
    async readCurrentAccount(userId, signal) {
      reads++;assert.equal(userId, actor);assert.equal(signal.aborted, false);
      if (options.dbFailure) throw Error('PRIVATE_DATABASE_DETAILS');
      if (options.hang) return new Promise(resolve => { release = resolve; });
      return snapshot;
    },
  });
  return { service, handler: createCmsHandler({ currentAccount: service, requestDeadlineMs: 1000 }),
    reads: () => reads, authCalls: () => ({ claimsCalls, userCalls }),
    replace(value: unknown) { snapshot = value; }, release: () => release(admin()) };
}
function request(body: unknown = { operation: 'current-account' }, bearer: string | null = token) {
  return new Request('https://cms.synthetic.invalid/api/cms', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }) }, body: JSON.stringify(body) });
}
for (const role of ['administrator', 'student'] as const) {
  test(`HTTP identifies active ${role} from current DB, not JWT role`, async () => {
    const f = fixture({ snapshot: { account: { user_id: actor, role, status: 'active' }, membership: role === 'administrator' ? { user_id: actor } : null },
      claims: { user_metadata: { role: 'administrator', status: 'active' } } });
    const response = await f.handler(request());assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { account: { userId: actor, role, status: 'active' } });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');assert.equal(f.reads(), 1);
    assert.deepEqual(f.authCalls(), { claimsCalls: 1, userCalls: 1 });
  });
}
for (const snapshot of [
  { ...admin(), account: { ...admin().account, status: 'pending_invitation' } },
  { ...admin(), account: { ...admin().account, status: 'disabled' } },
  { ...admin(), account: null },
  { ...admin(), membership: null },
  { ...admin(), membership: { user_id: other } },
  { ...admin(), account: { ...admin().account, user_id: other } },
  { ...admin(), account: { user_id: actor, role: 'student', status: 'active' } },
]) test(`denies noneligible/inconsistent DB snapshot ${JSON.stringify(snapshot)}`, async () => {
  const f = fixture({ snapshot });const response = await f.handler(request());
  assert.equal(response.status, 403);assert.deepEqual(await response.json(), { error: 'forbidden' });
});
for (const bearer of [null, '', 'opaque', `${token}, Bearer ${token}`]) test(`invalid/absent bearer ${bearer} never queries DB`, async () => {
  const f = fixture();const response = await f.handler(request(undefined, bearer));
  assert.equal(response.status, 401);assert.equal(f.reads(), 0);assert.equal(f.authCalls().claimsCalls, 0);
});
for (const claims of [{ iss: 'https://other.synthetic.invalid/auth/v1' }, { aud: 'other' }, { exp: 999 }, { sub: 'bad' }, { nbf: 1100 }]) {
  test(`rejects wrong project/claims before DB ${JSON.stringify(claims)}`, async () => {
    const f = fixture({ claims });assert.equal((await f.handler(request())).status, 401);assert.equal(f.reads(), 0);
  });
}
test('Auth rejects signed-looking token; no decoding-only authority', async () => {
  const f = fixture({ authError: { status: 401 } });assert.equal((await f.handler(request())).status, 401);assert.equal(f.reads(), 0);
});
test('Auth outage is unavailable, distinct from forbidden/unauthenticated', async () => {
  const f = fixture({ authError: { status: 503 } });assert.equal((await f.handler(request())).status, 503);assert.equal(f.reads(), 0);
});
test('Auth identity must match verified JWT subject', async () => {
  const f = fixture({ identity: other });assert.equal((await f.handler(request())).status, 401);assert.equal(f.reads(), 0);
});
test('database failure is sanitized and never becomes missing account', async () => {
  const f = fixture({ dbFailure: true });const response = await f.handler(request());
  assert.equal(response.status, 503);assert.deepEqual(await response.json(), { error: 'backend_unavailable' });assert.equal(f.reads(), 1);
});
test('fresh request sees account disablement, no account cache', async () => {
  const f = fixture();assert.equal((await f.handler(request())).status, 200);
  f.replace({ ...admin(), account: { ...admin().account, status: 'disabled' } });
  assert.equal((await f.handler(request())).status, 403);assert.equal(f.reads(), 2);
});
test('duplicate Authorization fields are rejected', async () => {
  const f = fixture();assert.deepEqual(await f.service.query([...headers, ...headers]), { kind: 'unauthenticated' });assert.equal(f.reads(), 0);
});
for (const extra of [{ role: 'administrator' }, { status: 'active' }, { userId: other }]) {
  test(`body cannot select authority or target ${JSON.stringify(extra)}`, async () => {
    const f = fixture();assert.equal((await f.handler(request({ operation: 'current-account', ...extra }))).status, 400);assert.equal(f.reads(), 0);
  });
}
for (const operation of ['register-student', 'register-administrator', 'update-account', 'delete-offer']) {
  test(`direct administrative operation ${operation} remains unavailable`, async () => {
    const f = fixture({ snapshot: { account: { user_id: actor, role: 'student', status: 'active' }, membership: null } });
    assert.equal((await f.handler(request({ operation }))).status, 503);assert.equal(f.reads(), 0);
  });
}
test('timeout ignores late database observation and does not retry', async () => {
  const f = fixture({ hang: true });const pending = f.service.query(headers);
  assert.deepEqual(await pending, { kind: 'unavailable' });f.release();await Promise.resolve();assert.equal(f.reads(), 1);
});
test('pre-cancelled query never contacts Auth or DB', async () => {
  const f = fixture();const cancel = new AbortController();cancel.abort();
  assert.deepEqual(await f.service.query(headers, cancel.signal), { kind: 'unavailable' });assert.equal(f.reads(), 0);assert.equal(f.authCalls().claimsCalls, 0);
});
test('HTTP rejects oversized JSON without reaching service', async () => {
  const f = fixture();assert.equal((await f.handler(request({ operation: 'current-account', padding: 'x'.repeat(2049) }))).status, 400);assert.equal(f.reads(), 0);
});

test('server authorization rechecks the actor and permission for each operation', async () => {
  const f = fixture();
  const authorize = createAdministrativeOperationAuthority(f.service);
  const signal = new AbortController().signal;
  // @ts-expect-error Unregistered runtime operation must also fail closed.
  assert.deepEqual(await authorize('accounts:update', headers, signal), { kind: 'forbidden' });
  assert.deepEqual(await authorize('offers:save', [], signal), { kind: 'unauthenticated' });
  assert.deepEqual(await authorize('offers:save', headers, signal), { kind: 'allowed', actorUserId: actor });
  f.replace({ account: { user_id: actor, role: 'student', status: 'active' }, membership: null });
  assert.deepEqual(await authorize('offers:save', headers, signal), { kind: 'forbidden' });
  f.replace({ ...admin(), membership: null });
  assert.deepEqual(await authorize('partners:delete', headers, signal), { kind: 'forbidden' });
  assert.equal(f.reads(), 3);
});
