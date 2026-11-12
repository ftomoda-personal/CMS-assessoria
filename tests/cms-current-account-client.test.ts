import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCurrentAccount } from '../src/lib/cms/currentAccountClient.ts';
import { currentAccountArea } from '../src/features/accounts/currentAccount.ts';
const actor = '10000000-0000-4000-8000-000000000001';
for (const role of ['administrator', 'student'] as const) test(`client validates ${role} own-account projection`, async () => {
  let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    calls++;assert.equal(url, '/api/cms');assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { operation: 'current-account' });
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-token');
    assert.equal(init?.credentials, 'omit');assert.equal(init?.redirect, 'error');
    return new Response(JSON.stringify({ account: { userId: actor, role, status: 'active' } }));
  };
  const result = await loadCurrentAccount('synthetic-token', actor, new AbortController().signal, transport);
  assert.equal(result.kind, 'current');assert.equal(calls, 1);
  if (result.kind === 'current') assert.equal(currentAccountArea(result.account), role);
});
for (const [status, kind] of [[401, 'unauthenticated'], [403, 'forbidden'], [503, 'unavailable']] as const) {
  test(`client preserves HTTP ${status}`, async () => {
    const result = await loadCurrentAccount('synthetic-token', actor, new AbortController().signal, async () => new Response('{}', { status }));
    assert.deepEqual(result, { kind });
  });
}
for (const account of [null, { userId: actor, role: 'administrator', status: 'disabled' },
  { userId: actor, role: 'owner', status: 'active' }, { userId: actor, role: 'student', status: 'active', admin: true },
  { userId: '20000000-0000-4000-8000-000000000002', role: 'administrator', status: 'active' }]) {
  test(`client cannot elevate malformed/mismatched response ${JSON.stringify(account)}`, async () => {
    const result = await loadCurrentAccount('synthetic-token', actor, new AbortController().signal,
      async () => new Response(JSON.stringify({ account })));
    assert.deepEqual(result, { kind: 'unavailable' });
  });
}
test('client catches transport failure without retry', async () => {
  let calls = 0;const result = await loadCurrentAccount('synthetic-token', actor, new AbortController().signal, async () => { calls++;throw Error('PRIVATE'); });
  assert.deepEqual(result, { kind: 'unavailable' });assert.equal(calls, 1);
});
test('cancelled client never publishes returned authority', async () => {
  const cancel = new AbortController();
  const result = await loadCurrentAccount('synthetic-token', actor, cancel.signal, async () => {
    cancel.abort();return new Response(JSON.stringify({ account: { userId: actor, role: 'administrator', status: 'active' } }));
  });assert.deepEqual(result, { kind: 'unavailable' });
});
