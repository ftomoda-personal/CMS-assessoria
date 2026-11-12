import type { HeaderFields } from '../als/bearer.ts';
import type { createCurrentAccountService } from './currentAccount.ts';

const administrativeOperations = [
  'partners:read', 'partners:create', 'partners:update', 'partners:delete',
  'offers:read', 'offers:save', 'offers:set-enabled', 'offers:activate-scheduled', 'offers:soft-delete',
] as const;

type AdministrativeOperation = typeof administrativeOperations[number];
type Authorization =
  | { readonly kind: 'allowed'; readonly actorUserId: string }
  | { readonly kind: 'unauthenticated' | 'forbidden' | 'unavailable' };

/** Bind the operation at the server endpoint. Forward the original verified bearer
 * through a request-local API client so RLS/RPC checks re-evaluate the same actor.
 * Each call checks current authority; its result is scoped to this request.
 */
export function createAdministrativeOperationAuthority(
  currentAccount: Pick<ReturnType<typeof createCurrentAccountService>, 'query'>,
) {
  const permissions: ReadonlySet<string> = new Set(administrativeOperations);
  return async (operation: AdministrativeOperation, headers: HeaderFields, signal: AbortSignal): Promise<Authorization> => {
    if (!permissions.has(operation)) return { kind: 'forbidden' };
    try {
      const result = await currentAccount.query(headers, signal);
      if (signal.aborted) return { kind: 'unavailable' };
      if (result.kind !== 'current') return { kind: result.kind };
      if (result.account.role !== 'administrator' || result.account.status !== 'active') return { kind: 'forbidden' };
      return { kind: 'allowed', actorUserId: result.account.userId };
    } catch {
      return { kind: 'unavailable' };
    }
  };
}
