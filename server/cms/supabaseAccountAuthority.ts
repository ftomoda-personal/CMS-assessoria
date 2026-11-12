import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractBearer } from '../als/bearer.ts';
import type { HeaderFields } from '../als/bearer.ts';
import type { AdministrativeAccountDecision } from './administrativeAccountReader.ts';
import type { ProvisioningTarget } from '../../src/features/accounts/domain.ts';

export type ExplicitTokenAuth = Pick<SupabaseClient['auth'], 'getClaims' | 'getUser'>;

/** Optional, disconnected production composition. Only a public publishable key
 * is accepted; no service-role/secret key, environment lookup or shared session.
 * A fresh client and request-bound fetch are created for each check. */
export function createIsolatedSupabaseAuth(url: string, publishableKey: string, signal: AbortSignal): ExplicitTokenAuth {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error('Expected trusted HTTPS project URL and public publishable key');
  }
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal }) },
  }).auth;
}

export interface SupabaseAccountAuthorityDependencies {
  readonly issuer: string;
  readonly audience: string;
  readonly deadlineMs: number;
  readonly nowSeconds: () => number;
  /** Trusted factory: isolated SDK client per request; never browser Auth state. */
  readonly createAuth: (signal: AbortSignal) => ExplicitTokenAuth;
  /** Trusted server reads of current cms_admins and accounts for this actor.
   * No cache or request-body records. Directly accepts the I-02E reader method;
   * explicit denial and unavailability must remain distinct. */
  readonly readAdministrator: (actorUserId: string, signal: AbortSignal) => Promise<AdministrativeAccountDecision>;
}
export type SupabaseStudentAuthority =
  | { readonly kind: 'denied' | 'unavailable' }
  | { readonly kind: 'authorized'; readonly actor: { readonly actorUserId: string };
      readonly requestId: string; readonly operation: 'register-student';
      readonly target: ProvisioningTarget; readonly targetRole: 'student' };

const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  && v !== '00000000-0000-0000-0000-000000000000';
function record(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
function intentSnapshot(value: unknown) {
  const input = record(value);
  const target = record(input?.target);
  if (!input || Object.keys(input).length !== 3 || !uuid(input.requestId)
    || input.operation !== 'register-student' || !target || Object.keys(target).length !== 2) return null;
  let snapshot: ProvisioningTarget;
  if (target.kind === 'user' && uuid(target.userId)) snapshot = { kind: 'user', userId: target.userId };
  else if (target.kind === 'email' && typeof target.email === 'string' && target.email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target.email)) snapshot = { kind: 'email', email: target.email };
  else return null;
  return Object.freeze({ requestId: input.requestId, operation: 'register-student' as const, target: Object.freeze(snapshot) });
}
function failure(error: { status?: number; name?: string } | null): 'denied' | 'unavailable' {
  return error && (error.name === 'AuthInvalidJwtError' || error.status === 401 || error.status === 403)
    ? 'denied' : 'unavailable';
}

/** DISABLED: no HTTP imports, dispatcher, SQL or provisioning. Option B only.
 * getClaims(originalToken, {allowExpired:false}) verifies JWT via SDK signature
 * verification or SDK Auth fallback; getUser(originalToken) independently fetches
 * Auth identity. Issuer/audience/expiration/subject are explicitly checked here.
 * No session_id is promoted into a session identity: neither operation proves
 * continuous liveness, immediate logout revocation, or all-channel password /
 * recovery revocation. D1–D3 remain unresolved under the original ALS contract.
 * Success is an immutable point-in-time observation for this request/operation/
 * student target, not a reusable privileged capability. A future dispatcher must
 * reauthorize every operation and define atomicity/TOCTOU and uncertainty handling.
 */
export function createSupabaseAccountAuthorityBoundary(deps: SupabaseAccountAuthorityDependencies) {
  const { issuer, audience, deadlineMs, nowSeconds, createAuth, readAdministrator } = deps;
  return Object.freeze({
    async checkStudentRegistration(fields: HeaderFields, requestContext: unknown,
      signal?: AbortSignal): Promise<SupabaseStudentAuthority> {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const started = performance.now();
      try {
        if (!issuer || !audience || !Number.isSafeInteger(deadlineMs) || deadlineMs <= 0
          || deadlineMs > 2_147_483_647 || signal?.aborted) return { kind: 'unavailable' };
        const token = extractBearer(fields);
        const intent = intentSnapshot(requestContext);
        if (!token || !intent) return { kind: 'denied' };
        signal?.addEventListener('abort', cancel, { once: true });
        const timeout = new Promise<SupabaseStudentAuthority>(resolve => {
          controller.signal.addEventListener('abort', () => resolve({ kind: 'unavailable' }), { once: true });
          timer = setTimeout(cancel, deadlineMs);
        });
        const work = async (): Promise<SupabaseStudentAuthority> => {
          const auth = createAuth(controller.signal);
          const verified = await auth.getClaims(token, { allowExpired: false });
          if (controller.signal.aborted) return { kind: 'unavailable' };
          if (verified.error || !verified.data) return { kind: failure(verified.error) };
          const claims = verified.data.claims;
          const actorUserId = claims.sub;
          const expiresAt = claims.exp;
          const now = nowSeconds();
          if (!Number.isFinite(now)) return { kind: 'unavailable' };
          if (!uuid(actorUserId) || claims.iss !== issuer
            || !(claims.aud === audience || (Array.isArray(claims.aud) && claims.aud.length > 0
              && claims.aud.every(a => typeof a === 'string') && claims.aud.includes(audience)))
            || !Number.isSafeInteger(expiresAt) || expiresAt <= now
            || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now))) return { kind: 'denied' };
          const current = () => !controller.signal.aborted && performance.now() - started < deadlineMs
            && Number.isFinite(nowSeconds()) && nowSeconds() < expiresAt;
          const user = await auth.getUser(token);
          if (!current()) return { kind: 'unavailable' };
          if (user.error || !user.data.user) return { kind: failure(user.error) };
          if (user.data.user.id !== actorUserId) return { kind: 'denied' };
          const admin = await readAdministrator(actorUserId, controller.signal);
          if (!current()) return { kind: 'unavailable' };
          if (admin.kind === 'denied' || admin.kind === 'unavailable') return { kind: admin.kind };
          // Independently preserve the verified-actor binding and minimum account
          // requirements even if a trusted injected reader returns inconsistent data.
          if (admin.kind !== 'authorized') return { kind: 'unavailable' };
          if (admin.actorUserId !== actorUserId || admin.membership?.user_id !== actorUserId
            || admin.account?.user_id !== actorUserId || admin.account.role !== 'administrator'
            || admin.account.status !== 'active') return { kind: 'denied' };
          return Object.freeze({ kind: 'authorized', actor: Object.freeze({ actorUserId }), ...intent, targetRole: 'student' });
        };
        const result = await Promise.race([work(), timeout]);
        return controller.signal.aborted || performance.now() - started >= deadlineMs ? { kind: 'unavailable' } : result;
      } catch { return { kind: 'unavailable' }; }
      finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        controller.abort();
      }
    },
  });
}
