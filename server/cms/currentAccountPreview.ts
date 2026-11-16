import { diagnoseCurrentAccount, initializationFailure } from './currentAccountDiagnostics.ts';
import { X509Certificate } from 'node:crypto';
import { CURRENT_ACCOUNT_STAGING_REF } from './administrativePgConnector.ts';
import { createCurrentAccountComposition } from './currentAccountComposition.ts';
import { handleCmsRequest } from './handler.ts';

function isValidCa(pem: string): boolean {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----/g);
  if (!blocks || pem.replace(/-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----/g, '').trim()) return false;
  const now = Date.now();
  return blocks.every(block => {
    const cert = new X509Certificate(block);
    return cert.ca && cert.validFromDate.getTime() <= now && now < cert.validToDate.getTime();
  });
}

export function bindCurrentAccountPreview(env: NodeJS.ProcessEnv, compose = createCurrentAccountComposition) {
  if (env.VERCEL_ENV !== 'preview' || env.CMS_RUNTIME_PROFILE !== 'staging-current-account'
    || env.CMS_STAGING_SUPABASE_PROJECT_REF !== CURRENT_ACCOUNT_STAGING_REF) return handleCmsRequest;

  const branch = env.VERCEL_GIT_COMMIT_REF;
  const branchMatches = branch === 'staging/current-account';
  let transport: 'session_pooler' | 'direct' | 'not_selected' = 'not_selected';
  try {
    const started = performance.now();
    const databasePassword = env.CMS_STAGING_CURRENT_ACCOUNT_DB_PASSWORD;
    const databaseCa = env.CMS_STAGING_CURRENT_ACCOUNT_DB_CA;
    const publishableKey = env.CMS_STAGING_SUPABASE_PUBLISHABLE_KEY;
    if (!databasePassword || !databaseCa || !publishableKey) {
      initializationFailure('config_gate', 'config_missing', started);
      return handleCmsRequest;
    }
    if (!databasePassword.trim() || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
      initializationFailure('config_gate', 'config_invalid', started);
      return handleCmsRequest;
    }
    try {
      if (!isValidCa(databaseCa)) throw Error('Invalid CA');
    } catch {
      initializationFailure('config_gate', 'ca_invalid', started);
      return handleCmsRequest;
    }
    try {
      const composition = compose('staging', {
        stagingSessionPooler: branchMatches,
        project: {
          projectRef: CURRENT_ACCOUNT_STAGING_REF,
          publishableKey,
          databasePassword,
          databaseCa,
          connectionTimeoutMs: 2000,
          queryTimeoutMs: 1500,
          shutdownMarginMs: 100,
          databaseDeadlineMs: 4500,
          authorityDeadlineMs: 6500,
          requestDeadlineMs: 8000,
        },
      });
      const handler = diagnoseCurrentAccount(composition.handler);
      transport = branchMatches ? 'session_pooler' : 'direct';
      return handler;
    } catch {
      initializationFailure('composition', 'composition_failed', started);
      return handleCmsRequest;
    }
  } finally {
    console.info('cms.current_account.preview_transport', JSON.stringify({
      branch_present: Boolean(branch), branch_matches: branchMatches, transport,
    }));
  }
}
