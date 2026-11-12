import { performance } from 'node:perf_hooks';
import type { AccountRow } from '../../src/features/accounts/domain.ts';

export type AdministrativeAccountProjection = Pick<AccountRow, 'user_id' | 'role' | 'status'>;

/** Trusted server-only dependency, not a request-body interface. No implementation
 * or database principal is supplied: existing API roles cannot read accounts and
 * the F10 principal is not qualified for these reads.
 *
 * Each call must freshly query public.cms_admins(user_id) and
 * public.accounts(user_id,role,status), filtered by the exact actor parameter, in
 * one consistent snapshot. Return null for a confirmed absent row; never turn
 * permissions/transport errors into absence. Resolve `read` only after confirmed
 * successful completion; throw or return `unavailable` on any uncertain outcome.
 * Observe cancellation and release resources. No cache, writes, retries, Auth
 * metadata, JWT role authorization, role switching or privilege fallback.
 */
export interface AdministrativeAccountDatabase {
  readCurrentAdministrator(actorUserId: string, signal: AbortSignal): Promise<unknown>;
}
/** Runtime-validated database envelope. Unknown at the injection boundary to
 * prevent malformed, contradictory or partial results from becoming authority. */
export type AdministrativeDatabaseRead =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'read'; readonly membership: { readonly user_id: string } | null;
      readonly account: AdministrativeAccountProjection | null };
export type AdministrativeAccountDecision =
  | { readonly kind: 'denied' | 'unavailable' }
  | { readonly kind: 'authorized'; readonly actorUserId: string;
      readonly membership: { readonly user_id: string };
      readonly account: AdministrativeAccountProjection };

function record(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  && v !== '00000000-0000-0000-0000-000000000000';

/** Dormant injectable reader only. Caller must already have verified the actor;
 * syntactic UUID validation here is not authentication. An authorized result is
 * only a point-in-time data observation, not a capability or session-liveness
 * proof. Re-read for each privileged operation; dispatch/TOCTOU remains separate.
 *
 * Minimal projection deliberately omits name/timestamps. The readAdministrator
 * method can be injected directly into the Supabase authority boundary, which
 * preserves denied/unavailable and rechecks the verified actor binding. No full
 * AccountRow, fabricated metadata or operational database composition is needed.
 */
export function createAdministrativeAccountReader(deps: {
  readonly database: AdministrativeAccountDatabase;
  readonly deadlineMs: number;
}) {
  const { database, deadlineMs } = deps;
  return Object.freeze({
    async readAdministrator(actorUserId: string, signal?: AbortSignal): Promise<AdministrativeAccountDecision> {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      const started = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 2_147_483_647 || signal?.aborted) return { kind: 'unavailable' };
        if (!uuid(actorUserId)) return { kind: 'denied' };
        signal?.addEventListener('abort', cancel, { once: true });
        const timeout = new Promise<AdministrativeAccountDecision>(resolve => {
          controller.signal.addEventListener('abort', () => resolve({ kind: 'unavailable' }), { once: true });
          timer = setTimeout(cancel, deadlineMs);
        });
        const work = async (): Promise<AdministrativeAccountDecision> => {
          const response = record(await database.readCurrentAdministrator(actorUserId, controller.signal));
          if (controller.signal.aborted || performance.now() - started >= deadlineMs) return { kind: 'unavailable' };
          if (!response || response.kind !== 'read' || Object.keys(response).length !== 3
            || !Object.hasOwn(response, 'membership') || !Object.hasOwn(response, 'account')) return { kind: 'unavailable' };
          const membership = record(response.membership);
          const account = record(response.account);
          // Validate both sources before treating confirmed absence as denial.
          if ((response.membership !== null && (!membership || Object.keys(membership).length !== 1 || !uuid(membership.user_id)))
            || (response.account !== null && (!account || Object.keys(account).length !== 3 || !uuid(account.user_id)
              || !['administrator', 'student'].includes(account.role as string)
              || !['active', 'pending_invitation', 'disabled'].includes(account.status as string)))) return { kind: 'unavailable' };
          if (!membership || !account || membership.user_id !== actorUserId || account.user_id !== actorUserId
            || account.role !== 'administrator' || account.status !== 'active') return { kind: 'denied' };
          return Object.freeze({ kind: 'authorized', actorUserId,
            membership: Object.freeze({ user_id: actorUserId }),
            account: Object.freeze({ user_id: actorUserId, role: 'administrator', status: 'active' }) });
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
