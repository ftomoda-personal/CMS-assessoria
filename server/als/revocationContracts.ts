import type { VerifiedLiveContext } from "./liveness.ts";
import type { ExactBearer } from "./liveness.ts";

export type AuthSignOutScope = "local" | "global";
/** Immutable, server-created intent. Persist its full tuple before dispatch.
 * Auth local means selected current-session scope, not browser credential disposal. */
export interface RevocationIntent {
  readonly operationId: string;
  readonly userId: string;
  readonly actorSessionId: string;
  readonly kind: "session" | "user";
  readonly sessionId: string | null;
  readonly purpose: "logout" | "session-revocation" | "membership-generation-revocation";
  readonly authScope: AuthSignOutScope | null;
}
export interface RevocationRecord {
  readonly state: "recorded";
  readonly operation_id: string;
  readonly user_id: string;
  readonly kind: "session" | "user";
  readonly session_id: string | null;
  readonly generation_before: string | null;
  readonly generation_after: string | null;
  readonly affected: number;
}
export interface TransactionOptions { readonly isolation: "read committed"; readonly signal: AbortSignal }
export type RevocationWrite =
  | { readonly kind: "committed"; readonly record: unknown }
  | { readonly kind: "rejected"; readonly rollback: "confirmed" }
  | { readonly kind: "uncertain" };
export type RevocationRead =
  | { readonly kind: "found"; readonly snapshot: "committed"; readonly record: unknown }
  | { readonly kind: "absent-uncertain" }
  | { readonly kind: "unavailable" };
export interface RevocationDatabase {
  /** Calls private revoke_cms_access(operation,user,session,kind), using one RC
   * transaction/connection; existing core locks operation -> membership -> generation
   * -> admissions, preserving terminal tombstones/immutable consumption. Only the
   * transport's confirmed COMMIT permits committed, never SQL state=recorded alone.
   * No automatic transport/SQL retries, refresh or generation supplied by caller. */
  revoke(intent: RevocationIntent, options: TransactionOptions): Promise<RevocationWrite>;
  /** READ ONLY, independent committed snapshot via reconcile_cms_revocation(op,user).
   * Missing history is absent-uncertain, not rollback proof or permission to retry. */
  reconcile(intent: RevocationIntent, options: TransactionOptions): Promise<RevocationRead>;
}
export type AuthProgress = "succeeded" | "failed" | "uncertain";
export interface OperationJournal {
  /** Durable atomic reservation binds ALL intent fields. Only the creator receives
   * reserved, at most once. Existing reservations NEVER authorize another DB write.
   * No in-memory implementation is supplied for operational use. */
  reserve(intent: RevocationIntent, signal: AbortSignal): Promise<"reserved" | "existing" | "conflict" | "unavailable">;
  /** Durable at-most-once Auth dispatch claim for this full intent. After pending,
   * lost replies cannot safely authorize another local/global Auth sign-out. */
  beginAuth(intent: RevocationIntent, signal: AbortSignal): Promise<"started" | "pending" | AuthProgress | "conflict" | "unavailable">;
  /** Persist the terminal observation; never change failed/uncertain to success
   * without separately qualified authoritative evidence. No automatic Auth retry. */
  finishAuth(intent: RevocationIntent, progress: AuthProgress, signal: AbortSignal): Promise<"confirmed" | "unavailable">;
}
export interface AuthSignOutRequest {
  readonly intent: RevocationIntent;
  readonly scope: AuthSignOutScope;
  readonly credential: ExactBearer;
  readonly signal: AbortSignal;
}
export interface AuthSignOutAdapter {
  /** Explicit selected scope and original exact bearer. No implicit SDK defaults,
   * refresh, inherited client session or claim of access-JWT invalidation. An ack
   * describes only this request's outcome, subject to later live qualification. */
  signOut(request: AuthSignOutRequest): Promise<{ readonly kind: "acknowledged" | "failed" | "unavailable"; readonly binding: AuthSignOutRequest }>;
}
export interface F07ContextAccess {
  owns(context: VerifiedLiveContext): boolean;
  withVerifiedBearer<T>(context: VerifiedLiveContext, consumer: (token: string) => T): T;
}
export type CmsRevocation = "not-requested" | "rejected" | "uncertain" | "confirmed";
export interface RevocationState {
  readonly intent: RevocationIntent;
  readonly state: "blocked" | "cms-rejected" | "cms-uncertain" | "cms-confirmed" | "logout-incomplete" | "awaiting-client-disposal";
  readonly cms: CmsRevocation;
  readonly auth: "not-requested" | AuthProgress;
  readonly record?: RevocationRecord;
  /** Revocation/uncertainty never grants subsequent administrative access. */
  readonly administrativeAccess: "deny";
}
