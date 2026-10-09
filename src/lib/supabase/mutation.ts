import type { ReadClient } from "./readDataset";

export interface MutationOptions { readonly signal?: AbortSignal }
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
  const { signal } = options;
  if (signal?.aborted) throw new MutationError("cancelled");
  const getSession = async () => {
    try {
      const response = await client.auth.getSession();
      return response.error ? null : response.data.session;
    } catch { return null; }
  };
  const initial = await getSession();
  if (signal?.aborted) throw new MutationError("cancelled");
  if (!initial) throw new MutationError("authorization");
  const userId = initial.user.id;
  const token = initial.access_token;
  let prepared = false;
  let dispatched = false;
  const sameSession = async () => {
    const current = await getSession();
    return Boolean(current && current.user.id === userId && current.access_token === token);
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
      if (!await sameSession()) throw new MutationError("stale");
      let admin: boolean;
      try { admin = await authorized(); }
      catch (error) {
        if (signal?.aborted) throw new MutationError("cancelled");
        if (!await sameSession()) throw new MutationError("stale");
        throw error;
      }
      if (signal?.aborted) throw new MutationError("cancelled");
      if (!await sameSession()) throw new MutationError("stale");
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
    interruption() { return new MutationError(dispatched ? "uncertain" : signal?.aborted ? "cancelled" : "response"); },
    async canApplyResult() {
      if (!dispatched || signal?.aborted || !await sameSession()) return false;
      try { return await authorized() && await sameSession() && !signal?.aborted; }
      catch { return false; }
    },
  };
}
