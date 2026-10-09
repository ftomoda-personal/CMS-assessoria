import type { ReadClient } from "./readDataset";

declare const sessionGuardBrand: unique symbol;
/** Opaque, process-local capability; JSON serialization is explicitly prohibited. */
export interface SessionContinuityGuard { readonly [sessionGuardBrand]: true }
export interface MutationOptions { readonly signal?: AbortSignal; readonly sessionGuard?: SessionContinuityGuard }
type SessionIdentity = { userId: string; sessionId: string };
const sessionGuards = new WeakMap<SessionContinuityGuard, { auth: ReadClient["auth"]; identity: SessionIdentity; invalidated: boolean }>();
// Verified-token cache is private and bounded to one token per auth client.
const verifiedTokens = new WeakMap<ReadClient["auth"], { token: string; identity: SessionIdentity }>();
async function observeIdentity(client: ReadClient, signal?: AbortSignal): Promise<SessionIdentity> {
  const checkAbort = () => { if (signal?.aborted) throw new MutationError("cancelled"); };
  checkAbort();
  try {
    const observed = await client.auth.getSession();
    checkAbort();
    const session = observed.data.session;
    if (observed.error || !session) throw new MutationError("authorization");
    const token = session.access_token;
    let identity = verifiedTokens.get(client.auth)?.token === token ? verifiedTokens.get(client.auth)!.identity : undefined;
    if (!identity) {
      if (!client.auth.getClaims) throw new MutationError("stale");
      const verified = await client.auth.getClaims(token);
      checkAbort();
      const claims = verified.data?.claims;
      if (verified.error || !claims || claims.sub !== session.user.id) throw new MutationError("stale");
      try { identity = { userId: parsePersistedUuid(claims.sub), sessionId: parsePersistedUuid(claims.session_id) }; }
      catch { throw new MutationError("stale"); }
    }
    // Never apply asynchronous verification to a newer session/token. No automatic retry.
    const latest = await client.auth.getSession();
    checkAbort();
    if (latest.error || !latest.data.session || latest.data.session.access_token !== token || latest.data.session.user.id !== identity.userId) throw new MutationError("stale");
    verifiedTokens.set(client.auth, { token, identity });
    return identity;
  } catch (error) {
    checkAbort();
    throw error instanceof MutationError ? error : new MutationError("stale");
  }
}
const equalIdentity = (a: SessionIdentity, b: SessionIdentity) => a.userId === b.userId && a.sessionId === b.sessionId;

/** Verified JWT session identity survives token rotation; credentials remain private. */
export async function createSessionContinuityGuard(client: ReadClient, options: Pick<MutationOptions, "signal"> = {}): Promise<SessionContinuityGuard> {
  const identity = await observeIdentity(client, options.signal);
  const guard = Object.freeze(Object.defineProperty({}, "toJSON", { value: () => { throw new MutationError("response"); } })) as SessionContinuityGuard;
  sessionGuards.set(guard, { auth: client.auth, identity, invalidated: false });
  return guard;
}

export async function assertSessionContinuity(guard: SessionContinuityGuard, client: ReadClient, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new MutationError("cancelled");
  const state = sessionGuards.get(guard);
  if (!state || state.invalidated || state.auth !== client.auth) throw new MutationError("stale");
  try {
    const identity = await observeIdentity(client, signal);
    if (state.invalidated || !equalIdentity(identity, state.identity)) throw new MutationError("stale");
  } catch (error) {
    if (!(error instanceof MutationError && error.kind === "cancelled")) state.invalidated = true;
    throw error instanceof MutationError && error.kind === "cancelled" ? error : new MutationError("stale");
  }
}
declare const persistedUuid: unique symbol;
/** Validated transport identifier; validation never changes its representation. */
export type PersistedUuid = string & { readonly [persistedUuid]: true };
export function parsePersistedUuid(value: unknown): PersistedUuid {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new MutationError("response");
  }
  return value as PersistedUuid;
}

export type FollowUp<T> =
  | { readonly state: "not-needed" }
  | { readonly state: "pending" }
  | { readonly state: "completed"; readonly value: T }
  | { readonly state: "failed"; readonly error: MutationError };

/** Only construct after an authoritative database acknowledgment, never a local prediction. */
export interface ConfirmedPersistence<T> {
  readonly outcome: "confirmed";
  readonly operation: "persist";
  readonly id: PersistedUuid;
  readonly refresh: FollowUp<T>;
  readonly cleanup: FollowUp<void>;
}
export interface ConfirmedDeletion {
  readonly outcome: "confirmed";
  readonly operation: "delete";
  readonly id: PersistedUuid;
  readonly cleanup: FollowUp<void>;
}
export interface UncertainMutation {
  readonly outcome: "uncertain";
  /** Target UUID, when known; does not assert that the operation committed. */
  readonly id?: PersistedUuid;
  readonly error: MutationError;
}
export type MutationResult<T> = ConfirmedPersistence<T> | ConfirmedDeletion | UncertainMutation;
export type MutationErrorKind = "authorization" | "domain" | "conflict" | "missing" | "response" | "cancelled" | "uncertain" | "stale";

export class MutationError extends Error {
  readonly kind: MutationErrorKind;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly retryAutomatically = false;
  constructor(kind: MutationErrorKind, code?: string, httpStatus?: number) {
    super(`Supabase mutation: ${kind}`);
    this.name = "MutationError";
    this.kind = kind;
    this.code = code && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(code) ? code : undefined;
    this.httpStatus = Number.isInteger(httpStatus) && httpStatus! >= 100 && httpStatus! <= 599 ? httpStatus : undefined;
  }
}

/** Use ONLY for a received, definitive server rejection; never for transport failures.
 * Unknown codes remain response errors. P0001 carries no reliable specific rule identity.
 */
export function classifyMutationRejection(code?: string, httpStatus?: number): MutationError {
  const kind: MutationErrorKind = code === "42501" || httpStatus === 401 || httpStatus === 403 ? "authorization"
    : code === "23505" || code === "40001" || code === "40P01" ? "conflict"
    : code === "P0002" || httpStatus === 404 ? "missing"
    : code === "P0001" || code === "23503" || code === "23514" || code === "23502" || code === "22007" || code === "22P02" ? "domain"
    : "response";
  return new MutationError(kind, code, httpStatus);
}

export interface MutationLifecycle {
  /** Await immediately before dispatch. Checks session and current admin membership. */
  prepareDispatch(): Promise<void>;
  /** Final continuity/cancellation check after ALL asynchronous preflight steps. */
  verifyBeforeDispatch(): Promise<void>;
  /** Call synchronously immediately before starting the request, after prepareDispatch. */
  markDispatched(): void;
  /** Transport loss/abort after dispatch means uncertainty, not rollback. */
  interruption(): MutationError;
  /** After confirmed persistence, false suppresses stale UI without changing the outcome. */
  canApplyResult(): Promise<boolean>;
}

/** Shared client injection only; no auth listeners, mutation calls, retries or logging.
 * Session credentials stay inside closures and are never included in results/errors.
 */
export async function createMutationLifecycle(client: ReadClient, options: MutationOptions = {}): Promise<MutationLifecycle> {
  const { signal, sessionGuard } = options;
  if (signal?.aborted) throw new MutationError("cancelled");
  const initial = await observeIdentity(client, signal);
  if (sessionGuard) await assertSessionContinuity(sessionGuard, client, signal);
  const userId = initial.userId;
  let prepared = false;
  let dispatched = false;
  let invalidated = false;
  const sameSession = async () => {
    if (invalidated) return false;
    try {
      if (sessionGuard) await assertSessionContinuity(sessionGuard, client, signal);
      const current = await observeIdentity(client, signal);
      if (!equalIdentity(current, initial)) { invalidated = true; return false; }
      return true;
    } catch { if (!signal?.aborted) invalidated = true; return false; }
  };
  const authorized = async () => {
    let query = client.from("cms_admins").select("user_id").eq("user_id", userId);
    if (signal) query = query.abortSignal(signal);
    try {
      const response = await query.maybeSingle();
      if (response.error) throw classifyMutationRejection(response.error.code, response.status);
      return response.data?.user_id === userId;
    } catch (error) {
      if (error instanceof MutationError) throw error;
      throw new MutationError("response");
    }
  };
  return {
    async prepareDispatch() {
      if (dispatched) throw new MutationError("response");
      prepared = false;
      if (signal?.aborted) throw new MutationError("cancelled");
      if (!await sameSession()) throw new MutationError(signal?.aborted ? "cancelled" : "stale");
      let admin: boolean;
      try { admin = await authorized(); }
      catch (error) {
        if (signal?.aborted) throw new MutationError("cancelled");
        if (!await sameSession()) throw new MutationError(signal?.aborted ? "cancelled" : "stale");
        throw error;
      }
      if (signal?.aborted) throw new MutationError("cancelled");
      if (!await sameSession()) throw new MutationError(signal?.aborted ? "cancelled" : "stale");
      if (signal?.aborted) throw new MutationError("cancelled");
      if (!admin) throw new MutationError("authorization");
      prepared = true;
    },
    markDispatched() {
      if (dispatched || !prepared) throw new MutationError("response");
      if (signal?.aborted) throw new MutationError("cancelled");
      dispatched = true;
      prepared = false;
    },
    async verifyBeforeDispatch() {
      if (dispatched || !prepared) throw new MutationError("response");
      if (signal?.aborted) throw new MutationError("cancelled");
      const valid = await sameSession();
      if (signal?.aborted) throw new MutationError("cancelled");
      if (!valid) { prepared = false; throw new MutationError("stale"); }
    },
    interruption() { return new MutationError(dispatched ? "uncertain" : signal?.aborted ? "cancelled" : "response"); },
    async canApplyResult() {
      if (!dispatched || signal?.aborted || !await sameSession()) return false;
      try { return await authorized() && await sameSession() && !signal?.aborted; }
      catch { return false; }
    },
  };
}
