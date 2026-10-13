import { isVerificationJsonContentType } from "./contentType.ts";
import { objectRecord, parseRemoteVerification, validVerificationRequest, verificationResult } from "../../src/features/partners/logoVerificationContracts.ts";
import type { RemoteLogoObservation } from "../../src/features/partners/logoVerificationContracts";
export interface VerifiedIdentity { readonly userId: string; readonly sessionId: string; readonly expiresAt: number }
export type Authentication = { readonly kind: "verified"; readonly identity: VerifiedIdentity } | { readonly kind: "denied" | "unavailable" };
export type Membership = "admin" | "denied" | "unavailable";
export type AbuseDecision = { readonly kind: "allowed"; release(): Promise<void> } | { readonly kind: "rate-limited" | "concurrency-limited" | "unavailable" };
export interface VerificationHandlerDependencies {
  /** Must verify signature, issuer, audience and expiry; never decode-only/getSession. */
  authenticate(token: string): Promise<Authentication>;
  /** Must query current membership, not trust role claims or browser flags. */
  membership(identity: VerifiedIdentity): Promise<Membership>;
  /** Atomic distributed admission/concurrency lease required before deployment. */
  acquire(identity: VerifiedIdentity): Promise<AbuseDecision>;
  inspect(objectPath: string): Promise<RemoteLogoObservation>;
  now?: () => number;
}
const uuid = (v: unknown): v is string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** Framework-independent server-only handler. No default auth, limiter or secrets. */
export function createLogoVerificationHandler(deps: VerificationHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    let outcome: RemoteLogoObservation = { kind: "service-failure", reason: "unavailable" };
    let release: (() => Promise<void>) | undefined;
    try {
      const text = await request.text();
      if (request.method !== "POST" || text.length > 1024 || !isVerificationJsonContentType(request.headers.get("content-type"))) outcome = { kind: "invalid-request" };
      else {
        let input: unknown; try { input = JSON.parse(text); } catch { input = undefined; }
        if (!validVerificationRequest(input)) outcome = { kind: "invalid-request" };
        else {
          const token = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
          const verify = async (): Promise<VerifiedIdentity | "denied" | "unavailable"> => {
            if (!token) return "denied";
            // DI is a runtime boundary too: never forward an arbitrary discriminant.
            const auth = objectRecord(await deps.authenticate(token));
            if (!auth) return "unavailable";
            if (auth.kind === "denied" || auth.kind === "unavailable") return auth.kind;
            if (auth.kind !== "verified") return "unavailable";
            const i = objectRecord(auth.identity);
            if (!i || !uuid(i.userId) || !uuid(i.sessionId) || typeof i.expiresAt !== "number" || !Number.isFinite(i.expiresAt)) return "unavailable";
            const now = (deps.now ?? Date.now)() / 1000;
            if (!Number.isFinite(now)) return "unavailable";
            if (i.expiresAt <= now) return "denied";
            return Object.freeze({ userId: i.userId, sessionId: i.sessionId, expiresAt: i.expiresAt });
          };
          const identity = await verify();
          if (identity === "denied") outcome = { kind: "authorization-denied" };
          else if (identity !== "unavailable") {
            const member = await deps.membership(identity);
            if (member === "denied") outcome = { kind: "authorization-denied" };
            else if (member === "admin") {
              let admission: AbuseDecision;
              try { admission = await deps.acquire(identity); } catch { admission = { kind: "unavailable" }; }
              if (admission.kind === "allowed" && typeof admission.release !== "function") outcome = { kind: "service-failure", reason: "abuse-control-unavailable" };
              else if (admission.kind !== "allowed") outcome = { kind: "service-failure", reason: admission.kind === "unavailable" ? "abuse-control-unavailable" : admission.kind };
              else {
                release = () => admission.release();
                try { outcome = await deps.inspect(input.objectPath); } catch { outcome = { kind: "service-failure", reason: "unavailable" }; }
                const current = await verify();
                if (current === "denied") outcome = { kind: "authorization-denied" };
                else if (current === "unavailable") outcome = { kind: "service-failure", reason: "unavailable" };
                else if (current.userId !== identity.userId || current.sessionId !== identity.sessionId) outcome = { kind: "authorization-denied" };
                else {
                  const after = await deps.membership(current);
                  if (after !== "admin") outcome = after === "denied" ? { kind: "authorization-denied" } : { kind: "service-failure", reason: "unavailable" };
                }
              }
            }
          }
        }
      }
    } catch { outcome = { kind: "service-failure", reason: "unavailable" }; }
    finally { if (release) { try { await release(); } catch { outcome = { kind: "service-failure", reason: "abuse-control-unavailable" }; } } }
    const result = parseRemoteVerification(verificationResult(outcome));
    const status = result.kind === "invalid-request" ? 400 : result.kind === "authorization-denied" ? 403 : result.kind === "service-failure" ? result.reason === "rate-limited" || result.reason === "concurrency-limited" ? 429 : 503 : result.kind === "invalid-response" ? 502 : 200;
    return new Response(JSON.stringify(result), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  };
}
