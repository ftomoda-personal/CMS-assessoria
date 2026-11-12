export type RecoveryState = "unverified" | "ready" | "updating" | "uncertain" | "cleaning" | "cleanup-failed" | "login-required";
export interface VerifiedRecovery {
  /** Supplied only by a trusted adapter after supported server verification. */
  mechanism: "pkce-recovery" | "recovery-otp";
  updatePassword(password: string): Promise<"confirmed" | "rejected" | "uncertain">;
  discardLocalSession(): Promise<void>;
}
export interface RecoveryDriver {
  establish(): Promise<VerifiedRecovery | null>;
  discardLocalSession(): Promise<void>;
}
/** No URL parsing, authentication client, network or success simulation here.
 * Production currently has no establish/update adapter, and stays unverified. */
export function createRecoveryCoordinator(driver: RecoveryDriver, returnToLogin: () => void, requireExplicitLogin: () => boolean = () => false) {
  let state: RecoveryState = "unverified", context: VerifiedRecovery | null = null, pending = false;
  const listeners = new Set<() => void>();
  function publish(next: RecoveryState) { state = next; listeners.forEach(listener => listener()); }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async establish() {
      if (pending || state !== "unverified") return;
      pending = true;
      try {
        const verified = await driver.establish();
        context = verified && ["pkce-recovery", "recovery-otp"].includes(verified.mechanism) && typeof verified.updatePassword === "function" && typeof verified.discardLocalSession === "function" ? verified : null;
        if (context) publish("ready");
      }
      catch { context = null; }
      finally { pending = false; }
    },
    async update(password: string) {
      if (pending || state !== "ready" || !context) return;
      pending = true; publish("updating");
      try {
        const result = await context.updatePassword(password);
        if (result !== "confirmed") { publish(result === "uncertain" ? "uncertain" : "ready"); return; }
        publish("cleaning");
        try { await context.discardLocalSession(); if (!requireExplicitLogin()) throw new Error("Login isolation unavailable"); context = null; publish("login-required"); returnToLogin(); }
        catch { publish("cleanup-failed"); }
      } catch { publish("uncertain"); }
      finally { pending = false; }
    },
    async discardAndLeave() {
      if (pending || !["uncertain", "cleanup-failed"].includes(state)) return;
      pending = true; publish("cleaning");
      try { await driver.discardLocalSession(); if (!requireExplicitLogin()) throw new Error("Login isolation unavailable"); context = null; publish("login-required"); returnToLogin(); }
      catch { publish("cleanup-failed"); }
      finally { pending = false; }
    },
    async leave() {
      if (pending || ["uncertain", "cleanup-failed", "cleaning"].includes(state)) return;
      pending = true;
      try { if (context) await context.discardLocalSession(); else await driver.discardLocalSession(); if (!requireExplicitLogin()) throw new Error("Login isolation unavailable"); context = null; publish("login-required"); returnToLogin(); }
      catch { publish("cleanup-failed"); }
      finally { pending = false; }
    },
  };
}
