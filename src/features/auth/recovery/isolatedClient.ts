import { createClient } from "@supabase/supabase-js";
/** Separate namespace, memory-only storage, explicit URL handling. The default
 * transport denies every request. Only isolated tests inject synthetic fetch. */
export function createIsolatedRecoveryClient(url: string, publishableKey: string, transport: typeof fetch = async () => { throw new Error("Recovery transport disabled"); }, flowType: "pkce" | "implicit" = "pkce") {
  const memory = new Map<string, string>();
  const namespace = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  let disposed = false;
  const client = createClient(url, publishableKey, {
    auth: { storageKey: `xpto-recovery-${namespace}`, storage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { if (!disposed) memory.set(key, value); }, removeItem: key => { memory.delete(key); } }, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, flowType },
    global: { fetch: (...args) => { if (disposed) return Promise.reject(new Error("Recovery context discarded")); return transport(...args); } },
  });
  return { client, async discardLocalSession() { disposed = true; memory.clear(); await client.auth.dispose(); memory.clear(); } };
}
