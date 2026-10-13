import type { SupabaseClient } from "@supabase/supabase-js";
import { objectRecord } from "../../src/features/partners/logoVerificationContracts.ts";
import type { Authentication, Membership, VerifiedIdentity } from "./handler";

export interface VerifiedAuthClient {
  /** Cryptographic verification, not JWT decoding. SDK getClaims verifies via
   * configured project keys or Auth fallback; operational signing setup must be reviewed. */
  getClaims(token: string, options: { allowExpired: false }): Promise<unknown>;
  getUser(token: string): Promise<unknown>;
}
export interface RequestAuthDependencies {
  readonly auth: VerifiedAuthClient;
  /** Must create an unprivileged, request-local client with the publishable key and
   * this exact bearer token. Never mutate a shared client/header or use service role. */
  readonly createMembershipClient: (token: string) => Pick<SupabaseClient, "from">;
  readonly expectedIssuer: string;
  readonly expectedAudience: string;
  readonly now?: () => number;
}
const uuid = (v: unknown): v is string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function authFailure(response: unknown): Authentication | undefined {
  const r = objectRecord(response);
  if (!r || !Object.hasOwn(r, "error")) return { kind: "unavailable" };
  if (r.error === null) return undefined;
  const e = objectRecord(r.error);
  const emptyUser = objectRecord(r.data);
  const hasEmptyAuthData = r.data === null || !!emptyUser && Object.keys(emptyUser).length === 1 && Object.hasOwn(emptyUser, "user") && emptyUser.user === null;
  if (!e || !hasEmptyAuthData) return { kind: "unavailable" };
  // Only explicit authentication rejection signals. Ambiguous errors stay unavailable.
  if (e.status === 401 || e.status === 403 || ["bad_jwt", "jwt_expired", "session_not_found"].includes(e.code as string) || e.name === "AuthInvalidJwtError") return { kind: "denied" };
  return { kind: "unavailable" };
}
/** One factory instance per HTTP request. Token never leaves closures/results.
 * No auth listeners, live clients or privileged configuration are constructed.
 */
export function createRequestAuthAdapters(requestToken: string, deps: RequestAuthDependencies) {
  let verified: VerifiedIdentity | undefined;
  let memberClient: Pick<SupabaseClient, "from"> | undefined;
  const currentTime = () => (deps.now ?? Date.now)() / 1000;
  return {
    async authenticate(token: string): Promise<Authentication> {
      verified = undefined;
      if (typeof requestToken !== "string" || !requestToken || /\s/.test(requestToken) || token !== requestToken) return { kind: "denied" };
      try {
        if (!deps.expectedIssuer || !deps.expectedAudience || !Number.isFinite(currentTime())) return { kind: "unavailable" };
        const claimsResponse = await deps.auth.getClaims(requestToken, { allowExpired: false });
        const failure = authFailure(claimsResponse); if (failure) return failure;
        const claims = objectRecord(objectRecord(objectRecord(claimsResponse)?.data)?.claims);
        if (!claims || !uuid(claims.sub) || !uuid(claims.session_id) || typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp)) return { kind: "unavailable" };
        const audience = claims.aud;
        const audienceMatches = typeof audience === "string" ? audience === deps.expectedAudience
          : Array.isArray(audience) && audience.length > 0 && audience.every(v => typeof v === "string") && audience.includes(deps.expectedAudience);
        if (claims.iss !== deps.expectedIssuer || !audienceMatches || claims.exp <= currentTime()) return { kind: "denied" };
        const userResponse = await deps.auth.getUser(requestToken);
        const userFailure = authFailure(userResponse); if (userFailure) return userFailure;
        const user = objectRecord(objectRecord(objectRecord(userResponse)?.data)?.user);
        if (!user || !uuid(user.id)) return { kind: "unavailable" };
        if (user.id !== claims.sub) return { kind: "denied" };
        const now = currentTime(); if (!Number.isFinite(now)) return { kind: "unavailable" };
        if (claims.exp <= now) return { kind: "denied" };
        verified = Object.freeze({ userId: user.id, sessionId: claims.session_id, expiresAt: claims.exp });
        return { kind: "verified", identity: verified };
      } catch { return { kind: "unavailable" }; }
    },
    async membership(identity: VerifiedIdentity): Promise<Membership> {
      try {
        const now = currentTime();
        if (!verified || !identity || identity.userId !== verified.userId || identity.sessionId !== verified.sessionId || identity.expiresAt !== verified.expiresAt || !Number.isFinite(now) || verified.expiresAt <= now) return "denied";
        memberClient ??= deps.createMembershipClient(requestToken);
        const response = objectRecord(await memberClient.from("cms_admins").select("user_id").eq("user_id", verified.userId).retry(false).maybeSingle());
        if (!response || !Object.hasOwn(response, "status") || !Object.hasOwn(response, "data") || !Object.hasOwn(response, "error")
          || typeof response.status !== "number" || !Number.isInteger(response.status)) return "unavailable";
        if (response.error !== null) {
          const error = objectRecord(response.error);
          // A received rejection cannot coexist with success/data. Never infer
          // authorization from a matching user_id in a contradictory envelope.
          if (!error || response.data !== null || response.status < 400 || response.status >= 500) return "unavailable";
          return response.status === 401 || response.status === 403 || error.code === "42501" ? "denied" : "unavailable";
        }
        if (response.status !== 200) return "unavailable";
        const after = currentTime();
        if (!Number.isFinite(after)) return "unavailable";
        if (verified.expiresAt <= after) return "denied";
        if (response.data === null) return "denied";
        const data = objectRecord(response.data);
        if (!data || Object.keys(data).length !== 1 || !Object.hasOwn(data, "user_id") || !uuid(data.user_id)) return "unavailable";
        return data.user_id === verified.userId ? "admin" : "denied";
      } catch { return "unavailable"; }
    },
  };
}
