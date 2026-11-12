import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPostgresAdministrativeAccountDatabase, createPostgresCurrentAccountReader, CURRENT_ACCOUNT_SQL_ROLE } from '../server/cms/postgresAdministrativeAccountDatabase.ts';
import { createAdministrativeAccountReader } from '../server/cms/administrativeAccountReader.ts';
import type { PostgresConnector, PostgresSession, PostgresResult } from '../server/als/postgresRevocation.ts';
import { createAdministrativePgConnector, createCmsReaderPgTransport, STAGING_CURRENT_ACCOUNT_IDENTITY_SQL } from '../server/cms/administrativePgConnector.ts';
import type { AdministrativePgTransport } from '../server/cms/administrativePgConnector.ts';
const actor = '10000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
const data = () => ({ kind: 'read', membership: { user_id: actor }, account: { user_id: actor, role: 'administrator', status: 'active' } });
const response = (result: unknown): PostgresResult => ({ command: 'SELECT', transactionStatus: 'transaction', rowCount: 1, rows: [{ result }] });
const identity = () => ({ role: 'cms_admin_reader_runtime', login: 'cms_admin_reader_runtime', database: 'postgres',
  rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false,
  rolreplication: false, rolinherit: false, memberships: false, read_only: true,
  isolation: 'read committed', search_path: 'pg_catalog' });
function phase(sql: string): string {
  if (sql.startsWith('BEGIN')) return 'BEGIN';
  if (sql.includes('pg_catalog.set_config')) return 'CONFIGURE';
  if (sql.includes('pg_catalog.pg_roles')) return 'IDENTITY';
  if (sql.includes('cms_private.read_administrative_account') || sql.includes('cms_private.read_current_account')) return 'READ';
  if (sql === 'COMMIT') return 'COMMIT';
  throw Error('Unexpected SQL in synthetic transport');
}
function fixture(options: { envelope?: unknown; select?: Partial<PostgresResult>; initial?: PostgresSession['initialTransactionStatus'];
  fail?: string; hang?: string; commit?: Partial<PostgresResult>; deadline?: number; cancel?: AbortController;
  context?: Record<string, unknown>; configure?: Partial<PostgresResult>; identityResult?: Partial<PostgresResult>;
  begin?: Partial<PostgresResult>; cancelAt?: string; queryTimeoutMs?: unknown; shutdownMarginMs?: number } = {}) {
  let connects = 0; let discards = 0; let statementTimeoutMs = 0;
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  let resolveLate: (value: PostgresResult) => void = () => {};
  const session: PostgresSession & { queryTimeoutMs?: unknown } = {
    queryTimeoutMs: Object.hasOwn(options, 'queryTimeoutMs') ? options.queryTimeoutMs : 1000,
    initialTransactionStatus: options.initial ?? 'idle', discard() { discards++; },
    async query(sql, params) {
      calls.push({ sql, params });
      const step = phase(sql);
      if (options.cancel && step === (options.cancelAt ?? 'READ')) options.cancel.abort();
      if (step === options.fail) throw Error('synthetic failure');
      if (step === options.hang) return new Promise(resolve => { resolveLate = resolve; });
      if (step === 'BEGIN') return { command: 'BEGIN', transactionStatus: 'transaction', rowCount: null, rows: [], ...options.begin };
      if (step === 'CONFIGURE') {
        assert.equal(params[0], 'pg_catalog'); assert.match(String(params[1]), /^[1-9][0-9]*ms$/);
        assert.match(sql, /set_config\('search_path', \$1::text, true\)/);
        assert.match(sql, /set_config\('statement_timeout', \$2::text, true\)/);
        statementTimeoutMs = Number(String(params[1]).slice(0, -2));
        assert.ok(statementTimeoutMs <= (options.deadline ?? 1000));
        assert.ok(statementTimeoutMs < Number(session.queryTimeoutMs));
        return { command: 'SELECT', transactionStatus: 'transaction', rowCount: 1,
          rows: [{ search_path: 'pg_catalog', statement_timeout: params[1] }], ...options.configure };
      }
      if (step === 'IDENTITY') {
        assert.deepEqual(params, []);
        return { command: 'SELECT', transactionStatus: 'transaction', rowCount: 1,
          rows: [{ ...identity(), statement_timeout_ms: statementTimeoutMs, ...options.context }], ...options.identityResult };
      }
      if (step === 'READ') {
        return { ...response(options.envelope === undefined ? data() : options.envelope), ...options.select };
      }
      return { command: 'COMMIT', transactionStatus: 'idle', rowCount: null, rows: [], ...options.commit };
    } };
  const connector: PostgresConnector = { async connect() { connects++; if (options.fail === 'connect') throw Error('offline'); return session; } };
  // Synthetic budgets only, not proposed Vercel operational defaults.
  const database = createPostgresAdministrativeAccountDatabase({ connector, deadlineMs: options.deadline ?? 1000,
    shutdownMarginMs: options.shutdownMarginMs ?? (options.deadline === undefined ? 100 : 1) });
  return { database, connector, session, calls, connects: () => connects, discards: () => discards,
    release: () => resolveLate(response(data())) };
}
const signal = () => new AbortController().signal;
test('single function snapshot with original UUID binding and explicit confirmed COMMIT', async () => {
  const f = fixture(); const result = await f.database.readCurrentAdministrator(actor, signal());
  assert.deepEqual(result, data());
  assert.deepEqual(f.calls.map(c => phase(c.sql)), ['BEGIN', 'CONFIGURE', 'IDENTITY', 'READ', 'COMMIT']);
  assert.deepEqual(f.calls[0], { sql: 'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY', params: [] });
  assert.deepEqual(f.calls[3], { sql: 'SELECT cms_private.read_administrative_account($1::uuid) AS result', params: [actor] });
  assert.deepEqual(f.calls[4], { sql: 'COMMIT', params: [] });
  assert.equal(f.connects(), 1); assert.equal(f.discards(), 1);
});
for (const envelope of [null, {}, { kind: 'unavailable' }, { kind: 'read', membership: null },
  { ...data(), error: 'uncertain' }, { ...data(), membership: { user_id: other } },
  { ...data(), account: { ...data().account, user_id: other } },
  { ...data(), account: { ...data().account, email: 'PRIVATE' } },
  { ...data(), account: { ...data().account, role: 'unknown' } },
  { ...data(), account: { ...data().account, status: 'unknown' } }]) {
  test(`invalid/mismatched envelope ${JSON.stringify(envelope)} is unavailable`, async () => {
    const f = fixture({ envelope }); assert.deepEqual(await f.database.readCurrentAdministrator(actor, signal()), { kind: 'unavailable' });
    assert.equal(f.discards(), 1); assert.equal(f.connects(), 1); assert.equal(f.calls.length, 4);
  });
}
for (const select of [{ rowCount: 0, rows: [] }, { rowCount: 2, rows: [{ result: data() }, { result: data() }] },
  { rows: [{ result: data(), extra: true }] }, { command: 'UPDATE' }, { transactionStatus: 'idle' as const }]) {
  test(`invalid driver response ${JSON.stringify(select)} fails closed`, async () => {
    const f = fixture({ select }); assert.deepEqual(await f.database.readCurrentAdministrator(actor, signal()), { kind: 'unavailable' });
    assert.equal(f.discards(), 1);
  });
}
for (const change of [{ membership: null }, { account: null }, { membership: null, account: null },
  { account: { ...data().account, status: 'disabled' } }, { account: { ...data().account, status: 'pending_invitation' } },
  { account: { ...data().account, role: 'student' } }]) {
  test(`confirmed ineligible data composes to denial ${JSON.stringify(change)}`, async () => {
    const f = fixture({ envelope: { ...data(), ...change } });
    const reader = createAdministrativeAccountReader({ database: f.database, deadlineMs: 1000 });
    assert.deepEqual(await reader.readAdministrator(actor), { kind: 'denied' });
    assert.equal(f.calls.at(-1)?.sql, 'COMMIT');
  });
}
for (const fail of ['connect', 'BEGIN', 'CONFIGURE', 'IDENTITY', 'READ', 'COMMIT']) {
  test(`failure at ${fail} never retries or returns partial data`, async () => {
    const f = fixture({ fail }); assert.deepEqual(await f.database.readCurrentAdministrator(actor, signal()), { kind: 'unavailable' });
    assert.equal(f.connects(), 1); assert.equal(f.discards(), fail === 'connect' ? 0 : 1);
    assert.equal(f.calls.filter(c => c.sql === 'COMMIT').length, fail === 'COMMIT' ? 1 : 0);
  });
}
for (const commit of [{ command: 'ROLLBACK' }, { transactionStatus: 'transaction' as const }]) {
  test(`unconfirmed COMMIT ${JSON.stringify(commit)} is unavailable`, async () => {
    const f = fixture({ commit }); assert.deepEqual(await f.database.readCurrentAdministrator(actor, signal()), { kind: 'unavailable' });
    assert.equal(f.discards(), 1); assert.equal(f.calls.length, 5);
  });
}
for (const hang of ['BEGIN', 'CONFIGURE', 'IDENTITY', 'READ', 'COMMIT']) {
  test(`timeout at ${hang} discards and rejects late results`, async () => {
    const f = fixture({ hang, deadline: 10 });
    const result = await f.database.readCurrentAdministrator(actor, signal());
    assert.deepEqual(result, { kind: 'unavailable' }); assert.equal(f.discards(), 1);
    assert.equal(phase(f.calls.at(-1)!.sql), hang, 'must reach the intended stalled phase');
    const count = f.calls.length; f.release(); await Promise.resolve(); await Promise.resolve();
    assert.equal(f.calls.length, count); assert.equal(f.connects(), 1);
  });
}
test('late connection is discarded after operation timeout', async () => {
  const f = fixture(); let release: (session: PostgresSession) => void = () => {};
  const database = createPostgresAdministrativeAccountDatabase({ deadlineMs: 10, shutdownMarginMs: 1,
    connector: { connect() { return new Promise(resolve => { release = resolve; }); } } });
  assert.deepEqual(await database.readCurrentAdministrator(actor, signal()), { kind: 'unavailable' });
  release(f.session); await Promise.resolve(); await Promise.resolve(); assert.equal(f.discards(), 1); assert.equal(f.calls.length, 0);
});
test('invalid actor, cancelled request and non-idle connection fail closed', async () => {
  const f = fixture(); assert.deepEqual(await f.database.readCurrentAdministrator('invalid', signal()), { kind: 'unavailable' });
  const abort = new AbortController(); abort.abort();
  assert.deepEqual(await f.database.readCurrentAdministrator(actor, abort.signal), { kind: 'unavailable' }); assert.equal(f.connects(), 0);
  const busy = fixture({ initial: 'transaction' });
  assert.deepEqual(await busy.database.readCurrentAdministrator(actor, signal()), { kind: 'unavailable' });
  assert.equal(busy.discards(), 1); assert.equal(busy.calls.length, 0);
});
test('in-flight cancellation cannot authorize after a SELECT response', async () => {
  const abort = new AbortController(); const f = fixture({ cancel: abort });
  assert.deepEqual(await f.database.readCurrentAdministrator(actor, abort.signal), { kind: 'unavailable' });
  assert.equal(f.discards(), 1); assert.equal(f.calls.length, 4);
});

for (const context of [
  { role: 'postgres' }, { login: 'service_role' },
  { role: 'cms_admin_reader_runtime.uhgeboelkbygidmhlugh' },
  { login: 'cms_admin_reader_runtime.uhgeboelkbygidmhlugh' },
  { database: 'other' }, { rolcanlogin: false }, { rolsuper: true },
  { rolbypassrls: true }, { rolcreaterole: true }, { rolcreatedb: true },
  { rolreplication: true }, { rolinherit: true }, { memberships: true },
  { read_only: false }, { isolation: 'repeatable read' }, { search_path: 'public' },
  { statement_timeout_ms: 0 }, { statement_timeout_ms: '1000' }, { role: undefined },
]) {
  test(`transaction context mismatch fails before reader ${JSON.stringify(context)}`, async () => {
    const f = fixture({ context });
    assert.deepEqual(await f.database.readCurrentAdministrator(actor, signal()), { kind: 'unavailable' });
    assert.deepEqual(f.calls.map(c => phase(c.sql)), ['BEGIN', 'CONFIGURE', 'IDENTITY']);
    assert.equal(f.connects(), 1); assert.equal(f.discards(), 1);
  });
}
for (const change of [
  { begin: { transactionStatus: 'idle' as const } },
  { configure: { transactionStatus: 'idle' as const } },
  { configure: { rowCount: 0, rows: [] } },
  { configure: { command: 'UPDATE' } },
  { configure: { rows: [{ search_path: 'public', statement_timeout: '1s' }] } },
  { identityResult: { transactionStatus: 'failed' as const } },
  { identityResult: { rowCount: 0, rows: [] } },
  { identityResult: { rowCount: 2, rows: [{}, {}] } },
]) {
  test(`configuration/identity protocol failure cannot reach reader ${JSON.stringify(change)}`, async () => {
    const f = fixture(change);
    assert.deepEqual(await f.database.readCurrentAdministrator(actor, signal()), { kind: 'unavailable' });
    assert.equal(f.calls.some(c => phase(c.sql) === 'READ' || c.sql === 'COMMIT'), false);
    assert.equal(f.connects(), 1); assert.equal(f.discards(), 1);
  });
}
for (const cancelAt of ['CONFIGURE', 'IDENTITY']) {
  test(`cancellation at ${cancelAt} cannot authorize or call reader`, async () => {
    const abort = new AbortController(); const f = fixture({ cancel: abort, cancelAt });
    assert.deepEqual(await f.database.readCurrentAdministrator(actor, abort.signal), { kind: 'unavailable' });
    assert.equal(f.calls.some(c => phase(c.sql) === 'READ'), false); assert.equal(f.discards(), 1);
  });
}

for (const shutdownMarginMs of [0, -1, NaN, Infinity, 500]) {
  test(`invalid termination margin rejects before connection ${shutdownMarginMs}`, async () => {
    const f = fixture({ shutdownMarginMs });
    assert.deepEqual(await f.database.readCurrentAdministrator(actor, signal()), { kind: 'unavailable' });
    assert.equal(f.connects(), 0); assert.equal(f.calls.length, 0);
  });
}
for (const queryTimeoutMs of [undefined, 0, 100, -1, NaN, Infinity, '1000']) {
  test(`missing/inconsistent lease query budget rejects before BEGIN ${queryTimeoutMs}`, async () => {
    const f = fixture({ queryTimeoutMs });
    assert.deepEqual(await f.database.readCurrentAdministrator(actor, signal()), { kind: 'unavailable' });
    assert.equal(f.connects(), 1); assert.equal(f.discards(), 1); assert.equal(f.calls.length, 0);
  });
}
test('server timeout stays below client query cap with explicit termination margin', async () => {
  const f = fixture({ queryTimeoutMs: 80, shutdownMarginMs: 20 });
  assert.deepEqual(await f.database.readCurrentAdministrator(actor, signal()), data());
  assert.deepEqual(f.calls.find(c => phase(c.sql) === 'CONFIGURE')?.params, ['pg_catalog', '60ms']);
  assert.equal(f.discards(), 1);
});
test('positive server timeout above query cap is unavailable before reader', async () => {
  const f = fixture({ queryTimeoutMs: 80, shutdownMarginMs: 20, context: { statement_timeout_ms: 81 } });
  assert.deepEqual(await f.database.readCurrentAdministrator(actor, signal()), { kind: 'unavailable' });
  assert.deepEqual(f.calls.map(c => phase(c.sql)), ['BEGIN', 'CONFIGURE', 'IDENTITY']);
  assert.equal(f.discards(), 1); assert.equal(f.connects(), 1);
});

for (const outcome of ['active', 'disabled', 'identity-diverged', 'configure-failed', 'identity-cancelled'] as const) {
  test(`real connector/adapter with synthetic transport: ${outcome}`, async () => {
    // No network or database: the real modules share one injected stateful fake.
    let state = 'I'; let ends = 0; let identities = 0; let statementTimeoutMs = 0;
    const phases: string[] = []; const abort = new AbortController();
    const transport: AdministrativePgTransport = {
      async connect() {}, async end() { ends++; }, on() {}, getTransactionStatus() { return state; },
      async query(query) {
        assert.equal((query as { queryMode?: string }).queryMode, 'extended'); assert.equal(query.name, undefined);
        const step = phase(query.text); phases.push(step);
        if (step === 'BEGIN') { state = 'T'; return { command: 'BEGIN', rowCount: null, rows: [] }; }
        if (step === 'COMMIT') { state = 'I'; return { command: 'COMMIT', rowCount: null, rows: [] }; }
        if (step === 'CONFIGURE') {
          if (outcome === 'configure-failed') throw Error('synthetic configuration failure');
          assert.equal(query.values?.[0], 'pg_catalog');
          statementTimeoutMs = Number(String(query.values?.[1]).slice(0, -2));
          assert.ok(statementTimeoutMs > 0 && statementTimeoutMs <= 140);
          return { command: 'SELECT', rowCount: 1, rows: [{ search_path: 'pg_catalog', statement_timeout: `${statementTimeoutMs}ms` }] };
        }
        if (step === 'IDENTITY') {
          identities++;
          if (identities === 2 && outcome === 'identity-cancelled') abort.abort();
          return { command: 'SELECT', rowCount: 1, rows: [{ ...identity(),
            role: identities === 2 && outcome === 'identity-diverged' ? 'postgres' : 'cms_admin_reader_runtime',
            read_only: state === 'T', statement_timeout_ms: statementTimeoutMs }] };
        }
        assert.deepEqual(query.values, [actor]);
        return { command: 'SELECT', rowCount: 1, rows: [{ result: outcome === 'disabled'
          ? { ...data(), account: { ...data().account, status: 'disabled' } } : data() }] };
      },
    };
    const connector = createAdministrativePgConnector({ host: 'aws-1-sa-east-1.pooler.supabase.com', port: 6543,
      database: 'postgres', connectionUser: 'cms_admin_reader_runtime.uhgeboelkbygidmhlugh',
      password: 'synthetic-only', tls: {}, connectionTimeoutMs: 100, queryTimeoutMs: 150 }, () => transport);
    const database = createPostgresAdministrativeAccountDatabase({ connector, deadlineMs: 1000, shutdownMarginMs: 10 });
    const reader = createAdministrativeAccountReader({ database, deadlineMs: 1000 });
    const result = await reader.readAdministrator(actor, abort.signal);
    assert.equal(result.kind, outcome === 'active' ? 'authorized' : outcome === 'disabled' ? 'denied' : 'unavailable');
    assert.equal(ends, 1); assert.equal(phases.filter(p => p === 'BEGIN').length, 1);
    if (outcome === 'active' || outcome === 'disabled') {
      assert.deepEqual(phases, ['IDENTITY', 'BEGIN', 'CONFIGURE', 'IDENTITY', 'READ', 'COMMIT']);
    } else {
      assert.equal(phases.includes('READ'), false); assert.equal(phases.includes('COMMIT'), false);
    }
  });
}

test('current account reader uses its dedicated identity and fixed parameterized projection', async () => {
  const account = { user_id: actor, role: 'student', status: 'active' };
  const f = fixture({ context: { role: CURRENT_ACCOUNT_SQL_ROLE, login: CURRENT_ACCOUNT_SQL_ROLE },
    envelope: { kind: 'read', account, membership: null } });
  const read = createPostgresCurrentAccountReader({ connector: f.connector, deadlineMs: 1000, shutdownMarginMs: 100 });
  assert.deepEqual(await read(actor, signal()), { account, membership: null });
  assert.deepEqual(f.calls[3], { sql: 'SELECT cms_private.read_current_account($1::uuid) AS result', params: [actor] });
  assert.equal(f.calls[4].sql, 'COMMIT');
  assert.equal(f.discards(), 1);
});

for (const fail of ['connect', 'READ', 'COMMIT', 'wrong role']) {
  test(`current account reader rejects ${fail} as unavailable`, async () => {
    const context = fail === 'wrong role' ? {} : { role: CURRENT_ACCOUNT_SQL_ROLE, login: CURRENT_ACCOUNT_SQL_ROLE };
    const f = fixture({ context, fail });
    const read = createPostgresCurrentAccountReader({ connector: f.connector, deadlineMs: 1000, shutdownMarginMs: 100 });
    await assert.rejects(read(actor, signal()), /Current account read unavailable/);
    if (fail === 'wrong role') assert.equal(f.calls.some(call => phase(call.sql) === 'READ'), false);
  });
}

const approvedMembership = [true, true, 10, true, false, false];
const stagingConfig = {
  host: 'db.uhgeboelkbygidmhlugh.supabase.co', port: 5432, database: 'postgres',
  connectionUser: CURRENT_ACCOUNT_SQL_ROLE, password: 'synthetic-only', tls: {},
  connectionTimeoutMs: 1000, queryTimeoutMs: 1000, stagingCurrentAccount: true,
};

for (const [label, memberships] of [
  ['approved', [approvedMembership]],
  ['missing', null],
  ['reversed', [[false, false, 10, true, false, false]]],
  ['wrong member', [[true, false, 10, true, false, false]]],
  ['wrong grantor', [[true, true, 11, true, false, false]]],
  ['without admin', [[true, true, 10, false, false, false]]],
  ['with inherit', [[true, true, 10, true, true, false]]],
  ['with set', [[true, true, 10, true, false, true]]],
  ['extra association', [approvedMembership, approvedMembership]],
] as const) {
  for (const rejectedAt of ['connect', 'transaction'] as const) {
    if (label === 'approved' && rejectedAt === 'transaction') continue;
    test(`staging membership ${label} at ${rejectedAt}`, async () => {
      let state = 'I';
      let timeout = 0;
      let ends = 0;
      const phases: string[] = [];
      const transport: AdministrativePgTransport = {
        async connect() {},
        async end() { ends++; },
        on() {},
        getTransactionStatus() { return state; },
        async query(query) {
          const step = phase(query.text);
          phases.push(step);
          if (step === 'BEGIN') { state = 'T'; return { command: 'BEGIN', rowCount: null, rows: [] }; }
          if (step === 'COMMIT') { state = 'I'; return { command: 'COMMIT', rowCount: null, rows: [] }; }
          if (step === 'CONFIGURE') {
            timeout = Number(String(query.values?.[1]).slice(0, -2));
            return { command: 'SELECT', rowCount: 1, rows: [{ search_path: 'pg_catalog', statement_timeout: query.values?.[1] }] };
          }
          if (step === 'IDENTITY') {
            assert.equal(query.text, STAGING_CURRENT_ACCOUNT_IDENTITY_SQL);
            const checkpoint = state === 'T' ? 'transaction' : 'connect';
            return { command: 'SELECT', rowCount: 1, rows: [{ ...identity(), role: CURRENT_ACCOUNT_SQL_ROLE,
              login: CURRENT_ACCOUNT_SQL_ROLE, read_only: state === 'T', statement_timeout_ms: timeout,
              memberships: checkpoint === rejectedAt ? memberships : [approvedMembership] }] };
          }
          return { command: 'SELECT', rowCount: 1, rows: [{ result: data() }] };
        },
      };
      const connector = createCmsReaderPgTransport(stagingConfig, CURRENT_ACCOUNT_SQL_ROLE, () => transport);
      const read = createPostgresCurrentAccountReader({ connector, deadlineMs: 1000, shutdownMarginMs: 100,
        stagingCurrentAccount: true });
      if (label === 'approved') {
        const { account, membership } = data();
        assert.deepEqual(await read(actor, signal()), { account, membership });
        assert.deepEqual(phases, ['IDENTITY', 'BEGIN', 'CONFIGURE', 'IDENTITY', 'READ', 'COMMIT']);
      } else {
        await assert.rejects(read(actor, signal()), /Current account read unavailable/);
        assert.deepEqual(phases, rejectedAt === 'connect' ? ['IDENTITY'] : ['IDENTITY', 'BEGIN', 'CONFIGURE', 'IDENTITY']);
      }
      assert.equal(ends, 1);
    });
  }
}

test('staging membership profile cannot be selected for a different host or role', () => {
  assert.throws(() => createCmsReaderPgTransport({ ...stagingConfig, host: 'db.other.invalid' }, CURRENT_ACCOUNT_SQL_ROLE));
  assert.throws(() => createCmsReaderPgTransport(stagingConfig, 'cms_admin_reader_runtime'));
});
