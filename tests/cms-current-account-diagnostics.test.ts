import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCmsHandler } from '../server/cms/handler.ts';
import {
  categories, diagnosticError, diagnosticFailure, diagnosticStage,
  diagnoseCurrentAccount, initializationFailure,
} from '../server/cms/currentAccountDiagnostics.ts';

const request = () => new Request('https://cms.invalid/api/cms');
const unavailable = () => new Response('{"error":"backend_unavailable"}', { status: 503 });
type RequestStage = Parameters<typeof diagnosticStage>[0];

test('all permitted pairs emit only the fixed schema and preserve the first failure', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  for (const [stage, allowed] of Object.entries(categories)) {
    for (const category of allowed) {
      const previous = warn.mock.callCount();
      if (stage === 'composition' || stage === 'config_gate') {
        initializationFailure(stage, category as never, performance.now());
      } else {
        const response = unavailable();
        const wrapped = diagnoseCurrentAccount(() => {
          diagnosticStage(stage as RequestStage);
          diagnosticFailure(category);
          diagnosticStage('http_handler');
          diagnosticFailure('unknown');
          return response;
        });
        assert.equal(await wrapped(request()), response);
      }
      assert.equal(warn.mock.callCount(), previous + 1);
      const event = JSON.parse(warn.mock.calls[previous].arguments[0]);
      const { correlation_id: correlation, duration_ms: duration, ...rest } = event;
      assert.deepEqual(rest, { event: 'cms.current_account.unavailable', stage, category });
      assert.ok(Number.isFinite(duration) && duration >= 0 && duration % 10 === 0);
      if (stage === 'composition' || stage === 'config_gate') assert.equal(correlation, undefined);
      else assert.match(correlation, /^[0-9a-f]{16}$/);
    }
  }
});

test('concurrent requests classify known and unknown codes without serializing secrets', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const sensitive = 'Bearer fixture-token postgres://user:password@host fixture@example.invalid 10000000-0000-4000-8000-000000000001 SELECT fixture';
  const simulate = (stage: RequestStage, code: string, delay: number) =>
    diagnoseCurrentAccount(async () => {
      diagnosticStage(stage);
      await new Promise(resolve => setTimeout(resolve, delay));
      diagnosticError(Object.assign(new Error(sensitive), { code, cookie: sensitive }));
      return unavailable();
    })(request());
  await Promise.all([
    simulate('pg_connect', 'ENOTFOUND', 10),
    simulate('pg_read_current_account', '42501', 0),
    simulate('auth_user', sensitive, 2),
    simulate('pg_connect', 'ERR_TLS_CERT_ALTNAME_INVALID', 0),
    simulate('pg_connect', '28P01', 0),
  ]);
  const events = warn.mock.calls.map(call => JSON.parse(call.arguments[0]));
  assert.equal(events.length, 5);
  assert.equal(new Set(events.map(event => event.correlation_id)).size, 5);
  assert.deepEqual(new Set(events.map(event => [event.stage, event.category].join('/'))), new Set([
    'pg_connect/dns_resolution_failed', 'pg_read_current_account/sql_permission_denied',
    'auth_user/unknown', 'pg_connect/tls_validation_failed', 'pg_connect/sql_auth_rejected',
  ]));
  assert.doesNotMatch(JSON.stringify(events), /fixture|password|Bearer|SELECT|postgres:\/\//);
});

test('only 503 emits and a failing emitter leaves the response intact', async t => {
  const warn = t.mock.method(console, 'warn', () => { throw Error('logger failure'); });
  for (const status of [200, 401, 403, 503]) {
    const response = new Response(null, { status });
    assert.equal(await diagnoseCurrentAccount(() => response)(request()), response);
  }
  assert.equal(warn.mock.callCount(), 1);
});

test('handler distinguishes request cancellation from deadline during Auth', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  for (const cancelled of [true, false]) {
    const abort = new AbortController();
    const handler = diagnoseCurrentAccount(createCmsHandler({
      requestDeadlineMs: cancelled ? 1000 : 25,
      currentAccount: {
        async query(_headers, signal) {
          diagnosticStage('auth_claims');
          if (cancelled) queueMicrotask(() => abort.abort());
          await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), { once: true }));
          return { kind: 'unavailable' };
        },
      },
    }));
    const result = await handler(new Request('https://cms.invalid/api/cms', {
      method: 'POST', signal: abort.signal,
      headers: { 'Content-Type': 'application/json' },
      body: '{"operation":"current-account"}',
    }));
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { error: 'backend_unavailable' });
    const event = JSON.parse(warn.mock.calls.at(-1)!.arguments[0]);
    assert.equal(event.stage, 'auth_claims');
    assert.equal(event.category, cancelled ? 'cancelled' : 'deadline_exceeded');
  }
  assert.equal(warn.mock.callCount(), 2);
});
