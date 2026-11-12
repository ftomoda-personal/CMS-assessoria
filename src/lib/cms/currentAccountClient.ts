import { parseCurrentAccount } from '../../features/accounts/currentAccount.ts';
import type { CurrentAccountLookup } from '../../features/accounts/currentAccount.ts';

/** Same-origin bearer request, no cookies, redirect, retry or local membership fallback. */
export async function loadCurrentAccount(token: string, expectedUserId: string,
  signal: AbortSignal, transport: typeof fetch = fetch): Promise<CurrentAccountLookup> {
  try {
    if (!token || signal.aborted) return { kind: 'unavailable' };
    const response = await transport('/api/cms', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ operation: 'current-account' }), credentials: 'omit',
      mode: 'same-origin', redirect: 'error', cache: 'no-store', signal });
    if (signal.aborted) return { kind: 'unavailable' };
    if (response.status === 401) return { kind: 'unauthenticated' };
    if (response.status === 403) return { kind: 'forbidden' };
    if (response.status !== 200) return { kind: 'unavailable' };
    const account = parseCurrentAccount(await response.json(), expectedUserId);
    return account && !signal.aborted ? { kind: 'current', account } : { kind: 'unavailable' };
  } catch { return { kind: 'unavailable' }; }
}
