import { createIsolatedRecoveryClient } from "./isolatedClient.ts";
import type { RecoveryLink } from "./callback.ts";
import type { RecoveryDriver } from "./coordinator.ts";
import { passwordRequirements } from "../passwordRequirements.ts";

export type RecoveryIssue = "invalid" | "expired" | "network" | "rate-limit" | "rejected" | "policy" | "uncertain";
export type RequestOutcome = "accepted" | "invalid-email" | "rate-limit" | "rejected" | "uncertain";
export interface RecoveryRequestAdapter { request(email: string): Promise<RequestOutcome> }
function classify(error: { status?: number; code?: string; name?: string } | null): RecoveryIssue {
  if (!error || !error.status || error.status >= 500 || error.name === "AuthRetryableFetchError") return "network";
  if (error.status === 429 || ["over_email_send_rate_limit", "over_request_rate_limit"].includes(error.code ?? "")) return "rate-limit";
  if (error.code === "otp_expired") return "expired";
  if (["weak_password", "same_password"].includes(error.code ?? "")) return "policy";
  return "rejected";
}
/** No production caller supplies a transport. Test-only composition injects a
 * synthetic fetch; no environment flag, URL flag or shared CMS client is used. */
export function createRecoveryAdapter(config: { url: string; key: string; callbackUrl: string; transport: typeof fetch }) {
  // Requests deliberately omit PKCE challenges: the custom email template must
  // point to token_hash verification, independent of the requesting browser.
  const owned = createIsolatedRecoveryClient(config.url, config.key, async (input, init) => {
    const url = new URL(String(input));
    const base = new URL(config.url);
    if (url.origin !== base.origin || !((init?.method === "POST" && /\/auth\/v1\/(recover|verify)$/.test(url.pathname)) ||
      (init?.method === "PUT" && url.pathname.endsWith("/auth/v1/user")))) throw new Error("Unsupported recovery operation");
    return config.transport(input, init);
  }, "implicit");
  let issue: RecoveryIssue | undefined, establishing = false, established = false, updating = false, consumed = false, requestPending = false, requestUncertain = false, disposed = false;
  let expiresAt = 0;
  let recoveryEvent = false;
  const subscription = owned.client.auth.onAuthStateChange(event => { if (event === "PASSWORD_RECOVERY") recoveryEvent = true; });
  async function discardLocalSession() { disposed = true; subscription.data.subscription.unsubscribe(); await owned.discardLocalSession(); }
  const driver = (link: RecoveryLink): RecoveryDriver => ({
    async establish() {
      if (consumed || establishing || disposed) return null;
      consumed = true;
      if (link.kind !== "token") { issue = "invalid"; return null; }
      establishing = true;
      const tokenHash = link.tokenHash;
      link.tokenHash = "";
      try {
        const { data, error } = await owned.client.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        if (disposed) return null;
        if (error) { const result = classify(error); issue = result === "rejected" ? "invalid" : result; return null; }
        if (!data.session || !data.user || data.user.id !== data.session.user.id || !recoveryEvent || !data.session.expires_at) { issue = "invalid"; return null; }
        if (data.session.expires_at <= Date.now() / 1000 + 120) { issue = "expired"; return null; }
        const verifiedUserId = data.user.id;
        established = true; expiresAt = data.session.expires_at; issue = undefined;
        return { mechanism: "recovery-otp", discardLocalSession,
          async updatePassword(password: string) {
            if (!established || disposed || updating) return "uncertain";
            if (!passwordRequirements(password).every(check => check.met)) { issue = "policy"; return "rejected"; }
            // Installed SDK proactively refreshes within 90s; reserve 120s and deny
            // the refresh endpoint as a second guard.
            if (expiresAt <= Date.now() / 1000 + 120) { issue = "expired"; established = false; return "uncertain"; }
            updating = true;
            try {
              const { data, error } = await owned.client.auth.updateUser({ password });
              if (error) {
                issue = classify(error);
                if (["policy", "rate-limit", "rejected"].includes(issue)) return "rejected";
                established = false; issue = "uncertain"; return "uncertain";
              }
              established = false;
              if (!data.user || data.user.id !== verifiedUserId) { issue = "uncertain"; return "uncertain"; }
              return "confirmed";
            } catch { established = false; issue = "uncertain"; return "uncertain"; }
            finally { updating = false; }
          },
        };
      } catch { issue = "network"; return null; }
      finally { establishing = false; if (!established) await discardLocalSession(); }
    }, discardLocalSession,
  });
  return {
    driver, issue: () => issue, discardLocalSession,
    async request(email: string): Promise<RequestOutcome> {
      const value = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) return "invalid-email";
      if (disposed || requestPending || requestUncertain) return "uncertain";
      requestPending = true;
      try {
        const { error } = await owned.client.auth.resetPasswordForEmail(value, { redirectTo: config.callbackUrl });
        if (!error) return "accepted";
        const result = classify(error);
        if (result === "network") { requestUncertain = true; return "uncertain"; }
        // Account-specific failures receive the same generic acknowledgement.
        if (["user_not_found", "email_not_confirmed"].includes(error.code ?? "")) return "accepted";
        return result === "rate-limit" ? "rate-limit" : "rejected";
      } catch { requestUncertain = true; return "uncertain"; }
      finally { requestPending = false; }
    },
  };
}
export type RecoveryAdapter = ReturnType<typeof createRecoveryAdapter>;
