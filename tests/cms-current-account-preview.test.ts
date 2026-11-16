import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { test } from 'node:test';
import { bindCurrentAccountPreview } from '../server/cms/currentAccountPreview.ts';
import { handleCmsRequest } from '../server/cms/handler.ts';

const ca = rootCertificates.find(pem => {
  const cert = new X509Certificate(pem);
  return cert.ca && cert.validFromDate.getTime() <= Date.now() && Date.now() < cert.validToDate.getTime();
})!;
const env = {
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'staging/current-account',
  CMS_RUNTIME_PROFILE: 'staging-current-account',
  CMS_STAGING_SUPABASE_PROJECT_REF: 'uhgeboelkbygidmhlugh',
  CMS_STAGING_CURRENT_ACCOUNT_DB_PASSWORD: 'synthetic-password',
  CMS_STAGING_CURRENT_ACCOUNT_DB_CA: ca,
  CMS_STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
};
const request = () => new Request('https://cms.invalid/api/cms', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ operation: 'current-account' }),
});

test('complete Preview uses the real composition and rejects absent Auth before any PostgreSQL connection', async () => {
  const handler = bindCurrentAccountPreview(env);
  assert.notEqual(handler, handleCmsRequest);
  assert.equal((await handler(request())).status, 401);
});

for (const [label, overrides] of Object.entries({
  'wrong profile': { CMS_RUNTIME_PROFILE: 'other' },
  'profile absent': { CMS_RUNTIME_PROFILE: undefined },
  Production: { VERCEL_ENV: 'production' },
  Development: { VERCEL_ENV: 'development' },
  'environment absent': { VERCEL_ENV: undefined },
  'wrong project': { CMS_STAGING_SUPABASE_PROJECT_REF: 'wrong' },
  'password absent': { CMS_STAGING_CURRENT_ACCOUNT_DB_PASSWORD: undefined },
  'CA absent': { CMS_STAGING_CURRENT_ACCOUNT_DB_CA: undefined },
  'CA invalid': { CMS_STAGING_CURRENT_ACCOUNT_DB_CA: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----' },
  'key absent': { CMS_STAGING_SUPABASE_PUBLISHABLE_KEY: undefined },
  'key invalid': { CMS_STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic' },
})) {
  test(`binding fails closed when ${label}`, async t => {
    const warn = t.mock.method(console, 'warn', () => {});
    const compose = t.mock.fn(() => assert.fail('must not compose'));
    const handler = bindCurrentAccountPreview({ ...env, ...overrides }, compose);
    assert.equal(handler, handleCmsRequest);
    assert.equal((await handler(request())).status, 503);
    assert.equal(compose.mock.callCount(), 0);
    assert.equal(warn.mock.callCount(), Object.keys(overrides).some(key => ['VERCEL_ENV', 'CMS_RUNTIME_PROFILE', 'CMS_STAGING_SUPABASE_PROJECT_REF'].includes(key)) ? 0 : 1);
  });
}

for (const [branch, selectsPooler] of [
  ['staging/current-account', true],
  ['staging/other', false],
  [undefined, false],
] as const) {
  test(`Preview transport selection for branch ${branch}`, t => {
    const compose = t.mock.fn<typeof import('../server/cms/currentAccountComposition.ts').createCurrentAccountComposition>(
      () => ({ handler: handleCmsRequest, authorizeAdministrativeOperation: () => assert.fail('unexpected authority') }),
    );
    bindCurrentAccountPreview({ ...env, VERCEL_GIT_COMMIT_REF: branch }, compose);
    assert.equal(compose.mock.callCount(), 1);
    assert.equal(compose.mock.calls[0].arguments[1].stagingSessionPooler, selectsPooler);
  });
}

test('composition errors containing configuration are absent from logs and response', async t => {
  const logs = ['log', 'error', 'warn', 'info', 'debug'].map(
    name => t.mock.method(console, name as 'log', () => {}),
  );
  const handler = bindCurrentAccountPreview(env, () => {
    throw new Error(Object.values(env).join('\n'));
  });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), await handleCmsRequest(request()).json());
  assert.equal(logs[2].mock.callCount(), 1);
  const event = JSON.parse(logs[2].mock.calls[0].arguments[0]);
  assert.deepEqual(event, { event: 'cms.current_account.unavailable', stage: 'composition', category: 'composition_failed', duration_ms: event.duration_ms });
  for (const log of logs.filter((_, i) => i !== 2)) assert.equal(log.mock.callCount(), 0);
});
