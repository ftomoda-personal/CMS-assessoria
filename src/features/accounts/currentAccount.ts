import type { AccountRole } from './domain.ts';

/** Own-account projection only. This response is never a capability for later work. */
export interface CurrentAccount {
  readonly userId: string;
  readonly role: AccountRole;
  readonly status: 'active';
}
export type CurrentAccountLookup =
  | { readonly kind: 'current'; readonly account: CurrentAccount }
  | { readonly kind: 'unauthenticated' | 'forbidden' | 'unavailable' };
const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)
  && v !== '00000000-0000-0000-0000-000000000000';
export function parseCurrentAccount(value: unknown, expectedUserId: string): CurrentAccount | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1
    || !Object.hasOwn(value, 'account')) return null;
  const account = (value as { account: unknown }).account;
  if (!account || typeof account !== 'object' || Array.isArray(account)
    || Object.keys(account).sort().join() !== 'role,status,userId') return null;
  const row = account as Record<string, unknown>;
  if (!uuid(row.userId) || row.userId !== expectedUserId || row.status !== 'active'
    || (row.role !== 'administrator' && row.role !== 'student')) return null;
  return Object.freeze({ userId: row.userId, role: row.role, status: 'active' });
}
export function currentAccountArea(account: CurrentAccount | null): 'administrator' | 'student' | null {
  if (!account || account.status !== 'active') return null;
  return account.role === 'administrator' ? 'administrator' : account.role === 'student' ? 'student' : null;
}
