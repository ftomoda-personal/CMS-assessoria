import { performance } from 'node:perf_hooks';
import { extractBearer } from '../als/bearer.ts';
import type { HeaderFields } from '../als/bearer.ts';
import { createIsolatedSupabaseAuth } from './supabaseAccountAuthority.ts';
import type { ExplicitTokenAuth } from './supabaseAccountAuthority.ts';
import { hasAdministrativeAccess, hasStudentAccess } from '../../src/features/accounts/domain.ts';
import type { AccountRow } from '../../src/features/accounts/domain.ts';
import type { CurrentAccountLookup } from '../../src/features/accounts/currentAccount.ts';

export interface CurrentAccountDependencies {
  readonly issuer: string;
  readonly audience: 'authenticated';
  readonly deadlineMs: number;
  readonly nowSeconds: () => number;
  readonly createAuth: (signal: AbortSignal) => ExplicitTokenAuth;
  /** Qualified, request-local database read in ONE snapshot. Resolve as
   * {account: {user_id,role,status}|null, membership: {user_id}|null}.
   * Actor comes exclusively from verified Auth. Null means confirmed absence;
   * permission/transport/query failures must throw, never become null.
   * The explicit server composition supplies the dedicated SQL reader.
   */
  readonly readCurrentAccount: (actorUserId: string, signal: AbortSignal) => Promise<unknown>;
}
const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)
  && v !== '00000000-0000-0000-0000-000000000000';
const record = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
function authFailure(error: { status?: number; name?: string } | null): CurrentAccountLookup {
  return { kind: error && (error.status === 401 || error.status === 403 || error.name === 'AuthInvalidJwtError') ? 'unauthenticated' : 'unavailable' };
}
/** Point-in-time Supabase Auth + current DB authority; NOT ALS-equivalent.
 * No environment reads, credentials, side effects, cache, retry or provisioning.
 */
export function createCurrentAccountService(deps: CurrentAccountDependencies) {
  return Object.freeze({ async query(fields: HeaderFields, signal?: AbortSignal): Promise<CurrentAccountLookup> {
    const controller = new AbortController(); const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unavailable = { kind: 'unavailable' } as const;
    const cancel = () => controller.abort();
    let expiresAt = Infinity;
    const current = () => {
      const now = deps.nowSeconds();
      if (controller.signal.aborted || performance.now() - started >= deps.deadlineMs
        || !Number.isFinite(now) || now >= expiresAt) throw Error('unavailable');
    };
    try {
      const token = extractBearer(fields);
      if (!token) return { kind: 'unauthenticated' };
      const issuer = new URL(deps.issuer);
      if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash
        || issuer.pathname !== '/auth/v1' || deps.audience !== 'authenticated'
        || !Number.isSafeInteger(deps.deadlineMs) || deps.deadlineMs < 1 || deps.deadlineMs > 2_147_483_647
        || signal?.aborted) return unavailable;
      signal?.addEventListener('abort', cancel, { once: true });
      const timeout = new Promise<CurrentAccountLookup>(resolve => {
        controller.signal.addEventListener('abort', () => resolve(unavailable), { once: true });
        timer = setTimeout(cancel, deps.deadlineMs);
      });
      const work = async (): Promise<CurrentAccountLookup> => {
        current();
        const auth = deps.createAuth(controller.signal);
        const verified = await auth.getClaims(token, { allowExpired: false }); current();
        if (verified.error || !verified.data) return authFailure(verified.error);
        const claims = verified.data.claims; const actor = claims.sub; const now = deps.nowSeconds();
        if (!uuid(actor) || claims.iss !== deps.issuer
          || !(claims.aud === deps.audience || (Array.isArray(claims.aud) && claims.aud.length > 0
            && claims.aud.every(a => typeof a === 'string') && claims.aud.includes(deps.audience)))
          || !Number.isSafeInteger(claims.exp) || claims.exp <= now
          || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now))) return { kind: 'unauthenticated' };
        expiresAt = claims.exp;
        const user = await auth.getUser(token); current();
        if (user.error || !user.data.user) return authFailure(user.error);
        if (user.data.user.id !== actor) return { kind: 'unauthenticated' };
        const raw = record(await deps.readCurrentAccount(actor, controller.signal)); current();
        if (!raw || Object.keys(raw).sort().join() !== 'account,membership') return unavailable;
        if (raw.account === null) return { kind: 'forbidden' };
        const account = record(raw.account); const member = record(raw.membership);
        if (!account || Object.keys(account).sort().join() !== 'role,status,user_id'
          || !uuid(account.user_id) || (account.role !== 'student' && account.role !== 'administrator')
          || (account.status !== 'active' && account.status !== 'pending_invitation' && account.status !== 'disabled')) return unavailable;
        if (raw.membership !== null && (!member || Object.keys(member).join() !== 'user_id' || !uuid(member.user_id))) return unavailable;
        if (account.user_id !== actor || (member && member.user_id !== actor)) return { kind: 'forbidden' };
        const projection: Pick<AccountRow, 'user_id' | 'role' | 'status'> = {
          user_id: account.user_id, role: account.role, status: account.status };
        const membership = member as { user_id: string } | null;
        const allowed = projection.role === 'administrator'
          ? hasAdministrativeAccess(actor, projection, membership)
          : hasStudentAccess(actor, projection) && membership === null;
        if (!allowed) return { kind: 'forbidden' };
        current();
        return { kind: 'current', account: Object.freeze({ userId: actor, role: projection.role, status: 'active' }) };
      };
      const result = await Promise.race([work(), timeout]); current();return result;
    } catch { return unavailable; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); cancel(); }
  } });
}
/** Optional future binding. Public key and origin come only from reviewed server
 * configuration. No .env loader/default project or live connection is supplied.
 */
export function createSupabaseCurrentAccountService(config: {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly deadlineMs: number;
  readonly readCurrentAccount: CurrentAccountDependencies['readCurrentAccount'];
}) {
  const endpoint = new URL(config.supabaseUrl);
  if (endpoint.protocol !== 'https:' || endpoint.origin !== config.supabaseUrl) throw Error('Expected trusted project origin');
  return createCurrentAccountService({ issuer: `${endpoint.origin}/auth/v1`, audience: 'authenticated',
    deadlineMs: config.deadlineMs, nowSeconds: () => Date.now()/1000,
    createAuth: signal => createIsolatedSupabaseAuth(config.supabaseUrl, config.publishableKey, signal),
    readCurrentAccount: config.readCurrentAccount });
}
