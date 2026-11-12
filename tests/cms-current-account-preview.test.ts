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
  test(`binding fails closed when ${label}`, async () => {
    const compose = () => assert.fail('must not compose');
    const handler = bindCurrentAccountPreview({ ...env, ...overrides }, compose);
    assert.equal(handler, handleCmsRequest);
    assert.equal((await handler(request())).status, 503);
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
  for (const log of logs) assert.equal(log.mock.callCount(), 0);
});
