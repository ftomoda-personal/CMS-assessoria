import { extractBearer, verifyBearer } from "./bearer.ts";
import { performance } from "node:perf_hooks";
import type { BearerIdentity, HeaderFields, JwtPolicy, SignatureVerifier } from "./bearer.ts";

/** Request-local opaque capability. JSON serialization never exposes the token.
 * Only the trusted injected adapter may consume the original bytes. */
export interface ExactBearer {
  use<T>(consumer: (token: string) => T): T;
}
export interface LivenessRequest {
  readonly identity: BearerIdentity;
  readonly credential: ExactBearer;
  readonly signal: AbortSignal;
}
export type LivenessEvidence =
  | { readonly kind: "live"; readonly binding: LivenessRequest; readonly userId: string; readonly sessionId: string }
  | { readonly kind: "invalid"; readonly binding: LivenessRequest }
  | { readonly kind: "unavailable" };
/** A future qualified authority must evaluate this EXACT bearer/session, including
 * applicable revocation and Auth policy. getUser or an auth.sessions row alone
 * cannot implement this contract. There is deliberately no Supabase adapter. */
export interface SessionAuthority {
  evaluate(request: LivenessRequest): Promise<LivenessEvidence>;
}
export const unavailableAuthority: SessionAuthority = Object.freeze({ async evaluate() { return { kind: "unavailable" as const }; } });
declare const verifiedContext: unique symbol;
export interface VerifiedLiveContext {
  readonly identity: BearerIdentity;
  readonly [verifiedContext]: true;
}
export type VerificationResult = { readonly kind: "verified-live"; readonly context: VerifiedLiveContext }
  | { readonly kind: "denied" } | { readonly kind: "unavailable" };
export interface BoundaryDependencies {
  readonly policy: JwtPolicy;
  readonly signature: SignatureVerifier;
  readonly authority: SessionAuthority;
  /** Explicit infrastructure deadline supplied by caller, no ALS timing default. */
  readonly deadlineMs: number;
}
/** No admission/issuance/business call. A live JWT is NOT password-grant proof. */
export function createVerificationBoundary(deps: BoundaryDependencies) {
  // Snapshot policy to prevent mutation while the authority is pending.
  const policy: JwtPolicy = Object.freeze({ ...deps.policy, algorithms: Object.freeze([...deps.policy.algorithms]) });
  const { signature, authority, deadlineMs } = deps;
  const contexts = new WeakSet<object>();
  const credentials = new WeakMap<VerifiedLiveContext, string>();
  return Object.freeze({
    /** Provenance check only, never a cached liveness/authorization decision. */
    owns(context: VerifiedLiveContext): boolean { return contexts.has(context); },
    /** Trusted server-only continuation (e.g. explicit sign-out after CMS revoke).
     * This does not revalidate liveness or authorize business operations. */
    withVerifiedBearer<T>(context: VerifiedLiveContext, consumer: (token: string) => T): T {
      const token = credentials.get(context);
      const now = policy.nowSeconds();
      if (!token || !Number.isFinite(now) || now >= context.identity.expiresAt) throw new Error("Invalid verification context");
      return consumer(token);
    },
    async verify(fields: HeaderFields, signal?: AbortSignal): Promise<VerificationResult> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();
      let onAbort: (() => void) | undefined;
      try {
        if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 2 ** 31 - 1 || signal?.aborted) return { kind: "unavailable" };
        const token = extractBearer(fields);
        if (!token) return { kind: "denied" };
        const jwt = verifyBearer(token, policy, signature);
        if (jwt.kind !== "verified") return jwt;
        const startedAt = performance.now();
        const request: LivenessRequest = Object.freeze({ identity: jwt.identity, signal: controller.signal,
          credential: Object.freeze({ use<T>(consumer: (value: string) => T): T {
            if (controller.signal.aborted) throw new Error("Verification request ended");
            return consumer(token);
          } }) });
        const interrupted = new Promise<undefined>(resolve => {
          onAbort = () => { controller.abort(); resolve(undefined); };
          signal?.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(onAbort, deadlineMs);
        });
        const evidence = await Promise.race([Promise.resolve().then(() => authority.evaluate(request)), interrupted]);
        if (!evidence || controller.signal.aborted || signal?.aborted || performance.now() - startedAt >= deadlineMs || evidence.kind === "unavailable") return { kind: "unavailable" };
        if (evidence.binding !== request) return { kind: "denied" };
        if (evidence.kind === "invalid") return { kind: "denied" };
        if (evidence.kind !== "live" || evidence.userId !== jwt.identity.userId || evidence.sessionId !== jwt.identity.sessionId) return { kind: "denied" };
        const now = policy.nowSeconds();
        if (!Number.isFinite(now)) return { kind: "unavailable" };
        if (now >= jwt.identity.expiresAt) return { kind: "denied" };
        const context = Object.freeze({ identity: jwt.identity }) as VerifiedLiveContext;
        contexts.add(context);
        credentials.set(context, token);
        return { kind: "verified-live", context };
      } catch { return { kind: "unavailable" }; }
      finally {
        if (timer !== undefined) clearTimeout(timer);
        if (onAbort) signal?.removeEventListener("abort", onAbort);
        controller.abort();
      }
    },
  });
}
