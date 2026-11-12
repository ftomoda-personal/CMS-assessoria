import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createAdministrativePgConnector } from '../server/cms/administrativePgConnector.ts';
import type { AdministrativePgConnectorConfig, AdministrativePgTransport, AdministrativePgTransportFactory } from '../server/cms/administrativePgConnector.ts';
// All transports below are injected fakes: this endpoint is never contacted.
const config: AdministrativePgConnectorConfig = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 6543, database: 'postgres',
  connectionUser: 'cms_admin_reader_runtime.uhgeboelkbygidmhlugh', password: 'synthetic-only', tls: {}, connectionTimeoutMs: 1000, queryTimeoutMs: 1000 };
function fixture(change: Record<string, unknown> = {}, hang = false) {
  let ends = 0; let queries = 0; let creations = 0;
  let supplied: Parameters<AdministrativePgTransportFactory>[0] | undefined;
  const transport: AdministrativePgTransport = {
    async connect() { if (hang) await new Promise(() => {}); },
    async end() { ends++; }, on() {}, getTransactionStatus() { return 'I'; },
    async query(input) {
      queries++;
      assert.equal((input as {queryMode?: string}).queryMode, 'extended');
      assert.equal(input.name, undefined);
      if (queries === 1) return { command: 'SELECT', rowCount: 1, rows: [{ role: 'cms_admin_reader_runtime', login: 'cms_admin_reader_runtime',
        database: 'postgres', rolcanlogin: true,
        rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false,
        rolreplication: false, rolinherit: false, memberships: false, ...change }] };
      return { command: 'SELECT', rowCount: 1, rows: [{ value: 1 }] };
    },
  };
  const factory: AdministrativePgTransportFactory = input => { supplied = input; creations++; return transport; };
  return { factory, transport, ends: () => ends, queries: () => queries, creations: () => creations, supplied: () => supplied };
}
test('no transport at factory creation; explicit TLS and parameterized query options', async () => {
  const f = fixture(); const connector = createAdministrativePgConnector(config, f.factory);
  assert.equal(f.creations(), 0);
  const session = await connector.connect(new AbortController().signal);
  assert.deepEqual(f.supplied()?.ssl, { rejectUnauthorized: true, ca: undefined, servername: config.host });
  assert.equal(f.supplied()?.user, config.connectionUser);
  assert.equal(f.supplied()?.options, undefined);
  assert.equal(f.supplied()?.statement_timeout, undefined);
  assert.equal(f.supplied()?.pipeline, false);
  assert.equal((session as typeof session & { queryTimeoutMs: number }).queryTimeoutMs, config.queryTimeoutMs);
  const original = f.transport.query;
  f.transport.query = async query => { assert.deepEqual(query.values, ['actor']); return original(query); };
  await session.query('SELECT $1', ['actor'], new AbortController().signal);
  session.discard(); session.discard(); assert.equal(f.ends(), 1);
});
for (const change of [{ connectionUser: 'cms_admin_reader_runtime' },
  { connectionUser: 'cms_admin_reader_runtime.paismtbcqnxgwprqrfdm' },
  { connectionUser: 'service_role.uhgeboelkbygidmhlugh' }, { connectionUser: 'postgres.uhgeboelkbygidmhlugh' },
  { user: 'postgres' }, { expectedRole: 'postgres' }, { host: 'synthetic.invalid' }, { port: 5432 }, { database: 'other' },
  { password: '' }, { host: '' }, { port: 0 }, { database: '' }, { connectionTimeoutMs: 0 },
  { queryTimeoutMs: Infinity }, { tls: false }, { tls: { rejectUnauthorized: false } },
  { tls: { servername: 'other.invalid' } }, { tls: [] }]) {
  test(`invalid authority/config fails before transport ${JSON.stringify(change)}`, () => {
    const f = fixture(); assert.throws(() => createAdministrativePgConnector({ ...config, ...change } as AdministrativePgConnectorConfig, f.factory));
    assert.equal(f.creations(), 0);
  });
}
for (const change of [{ role: 'postgres' }, { login: 'service_role' },
  { role: config.connectionUser }, { login: config.connectionUser }, { database: 'other' },
  { rolcanlogin: false }, { rolcanlogin: undefined }, { rolsuper: true }, { rolbypassrls: true },
  { rolinherit: true }, { memberships: true }, { rolcreatedb: true }, { rolcreaterole: true }, { rolreplication: true }]) {
  test(`rejects actual principal authority ${JSON.stringify(change)}`, async () => {
    const f = fixture(change);
    await assert.rejects(createAdministrativePgConnector(config, f.factory).connect(new AbortController().signal));
    assert.equal(f.ends(), 1); assert.equal(f.creations(), 1);
  });
}
test('pre-cancelled connect never creates transport', async () => {
  const f = fixture(); const abort = new AbortController(); abort.abort();
  await assert.rejects(createAdministrativePgConnector(config, f.factory).connect(abort.signal)); assert.equal(f.creations(), 0);
});
test('connection timeout discards transport without retry', async () => {
  const f = fixture({}, true);
  await assert.rejects(createAdministrativePgConnector({ ...config, connectionTimeoutMs: 10 }, f.factory).connect(new AbortController().signal));
  assert.equal(f.ends(), 1); assert.equal(f.creations(), 1);
});
test('query timeout rejects late result and closes connection', async () => {
  const f = fixture(); const session = await createAdministrativePgConnector({ ...config, queryTimeoutMs: 10 }, f.factory).connect(new AbortController().signal);
  let resolve: (v: {command: string; rowCount: number; rows: Record<string, unknown>[]}) => void = () => {};
  f.transport.query = () => new Promise(r => { resolve = r; });
  await assert.rejects(session.query('SELECT $1', ['actor'], new AbortController().signal));
  resolve({ command: 'SELECT', rowCount: 1, rows: [] }); assert.equal(f.ends(), 1);
  await assert.rejects(session.query('SELECT 1', [], new AbortController().signal));
});
test('query cancellation closes transport and sanitizes errors', async () => {
  const f = fixture(); const session = await createAdministrativePgConnector(config, f.factory).connect(new AbortController().signal);
  const abort = new AbortController(); f.transport.query = async () => { abort.abort(); throw Error('SECRET'); };
  await assert.rejects(session.query('SELECT $1', ['actor'], abort.signal), /^Error: PostgreSQL transport unavailable$/);
  assert.equal(f.ends(), 1);
});
test('TLS/connect failure is sanitized without identity query, retry or fallback', async () => {
  const f = fixture();
  f.transport.connect = async () => { throw Error('synthetic certificate failure PRIVATE'); };
  await assert.rejects(createAdministrativePgConnector(config, f.factory).connect(new AbortController().signal),
    /^Error: PostgreSQL transport unavailable$/);
  assert.equal(f.creations(), 1); assert.equal(f.ends(), 1); assert.equal(f.queries(), 0);
});
for (const state of ['T', 'E', null, '?']) {
  test(`unexpected initial transaction status ${state} discards before identity`, async () => {
    const f = fixture(); f.transport.getTransactionStatus = () => state;
    await assert.rejects(createAdministrativePgConnector(config, f.factory).connect(new AbortController().signal));
    assert.equal(f.ends(), 1); assert.equal(f.queries(), 0);
  });
  test(`unexpected status after initial identity ${state} discards without retry`, async () => {
    const f = fixture(); const original = f.transport.query;
    f.transport.query = async input => {
      const result = await original(input); f.transport.getTransactionStatus = () => state; return result;
    };
    await assert.rejects(createAdministrativePgConnector(config, f.factory).connect(new AbortController().signal));
    assert.equal(f.ends(), 1); assert.equal(f.queries(), 1); assert.equal(f.creations(), 1);
  });
}
for (const envelope of [{ command: 'UPDATE' }, { rowCount: 0, rows: [] },
  { rowCount: 2, rows: [{}, {}] }, { rows: [{}] }]) {
  test(`malformed initial identity fails closed ${JSON.stringify(envelope)}`, async () => {
    const f = fixture(); const original = f.transport.query;
    f.transport.query = async input => ({ ...await original(input), ...envelope });
    await assert.rejects(createAdministrativePgConnector(config, f.factory).connect(new AbortController().signal));
    assert.equal(f.creations(), 1); assert.equal(f.ends(), 1); assert.equal(f.queries(), 1);
  });
}
test('cancelled pending connect cannot start a late identity check', async () => {
  const f = fixture(); const abort = new AbortController(); let release = () => {};
  f.transport.connect = () => new Promise<void>(resolve => { release = resolve; });
  const pending = createAdministrativePgConnector(config, f.factory).connect(abort.signal);
  await Promise.resolve(); abort.abort();
  await assert.rejects(pending); release(); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.ends(), 1); assert.equal(f.queries(), 0); assert.equal(f.creations(), 1);
});
for (const pgOptions of ['', ' ', '-c search_path=public -c statement_timeout=0']) {
  test(`PGOPTIONS policy without parent environment mutation ${JSON.stringify(pgOptions)}`, () => {
    // Prepared local child test only: instantiate pg, never connect. Its isolated
    // environment demonstrates real pg fallback and the connector's early rejection.
    const program = `
      import { Client } from 'pg';
      import { createAdministrativePgConnector } from ${JSON.stringify(new URL('../server/cms/administrativePgConnector.ts', import.meta.url).href)};
      const before = process.env.PGOPTIONS;
      const native = new Client({ host: 'synthetic.invalid', database: 'synthetic', user: 'synthetic', password: 'synthetic-only' });
      let creations = 0; let rejected = false;
      try { createAdministrativePgConnector(${JSON.stringify(config)}, () => { creations++; throw Error('unexpected transport'); }); }
      catch (error) { if (error.message !== 'PostgreSQL transport unavailable') throw error; rejected = true; }
      console.log(JSON.stringify({ rejected, creations, environmentUnchanged: process.env.PGOPTIONS === before,
        driverUsesAmbientOptions: before === '' || native.connectionParameters.options === before }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
      cwd: new URL('..', import.meta.url), env: { ...process.env, PGOPTIONS: pgOptions },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { rejected: pgOptions !== '', creations: 0,
      environmentUnchanged: true, driverUsesAmbientOptions: true });
  });
}
test('SQL artifacts require qualification and remain outside HTTP', () => {
  const sql = readFileSync(new URL('../server/cms/sql/provision-administrative-reader.sql', import.meta.url), 'utf8');
  assert.match(sql, /current_setting\('cms.admin_reader_ownership_qualified'/);
  assert.match(sql, /language sql stable security definer set search_path = ''/);
  assert.match(sql, /from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /create role|alter .*owner|create policy|bypassrls\s*;/i);
  for (const path of ['../server/cms/handler.ts', '../api/cms.ts'])
    assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), 'utf8'), /administrativePgConnector|postgresAdministrativeAccountDatabase/);
});
