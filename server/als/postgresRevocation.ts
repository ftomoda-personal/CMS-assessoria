import { parseRecord, validIntent } from "./revocationValidation.ts";
import type { OperationJournal, RevocationDatabase, RevocationIntent, RevocationRead, RevocationWrite, TransactionOptions } from "./revocationContracts.ts";

/** Driver boundary: actual PostgreSQL command tags and ReadyForQuery status.
 * A SELECT result or a resolved Promise is NOT a COMMIT acknowledgement.
 * Driver wrappers must preserve server metadata, never synthesize it optimistically.
 * No concrete driver/DSN, network connection or production role is installed. */
export interface PostgresResult {
  readonly command: string;
  readonly transactionStatus: "idle" | "transaction" | "failed";
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly rowCount: number | null;
}
export interface PostgresSession {
  /** Fresh exclusive connection; reject an already open/failed transaction. */
  readonly initialTransactionStatus: "idle" | "transaction" | "failed" | "unknown";
  query(sql: string, parameters: readonly unknown[], signal: AbortSignal): Promise<PostgresResult>;
  /** Idempotently discard the connection; abort/uncertain sessions are never pooled.
   * Closing a socket is not evidence of transaction rollback. */
  discard(): void;
}
export interface PostgresConnector {
  /** Must enforce caller's explicit connection/query deadlines, cooperate with
   * cancellation, authenticate a separately reviewed least-privilege role, and
   * return a NEW idle connection. No auto-retry/reconnect of a dispatched query. */
  connect(signal: AbortSignal): Promise<PostgresSession>;
}
const BEGIN_WRITE = "BEGIN ISOLATION LEVEL READ COMMITTED";
const BEGIN_READ = "BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY";
const REVOKE = "SELECT cms_private.revoke_reserved_cms_access($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text, $7::text) AS result";
const RECONCILE = "SELECT cms_private.reconcile_reserved_cms_access($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text, $7::text) AS result";
const RESERVE = "SELECT cms_private.reserve_cms_revocation_intent($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text, $7::text) AS result";
const BEGIN_AUTH = "SELECT cms_private.begin_cms_revocation_auth($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text, $7::text) AS result";
const FINISH_AUTH = "SELECT cms_private.finish_cms_revocation_auth($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text, $7::text, $8::text) AS result";
function acknowledged(result: PostgresResult, command: string, status: PostgresResult["transactionStatus"]): boolean {
  return result.command === command && result.transactionStatus === status;
}
function oneResult(result: PostgresResult): unknown {
  if (!acknowledged(result, "SELECT", "transaction") || result.rowCount !== 1 || result.rows.length !== 1
    || !Object.hasOwn(result.rows[0]!, "result")) throw new Error("Invalid PostgreSQL result envelope");
  return result.rows[0]!.result;
}
const parameters = (i: RevocationIntent): readonly unknown[] => [i.operationId, i.userId, i.actorSessionId, i.kind, i.sessionId, i.purpose, i.authScope];
function json(value: unknown): unknown { return typeof value === "string" ? JSON.parse(value) as unknown : value; }
type TransactionResult<T> = { readonly kind: "committed"; readonly value: T }
  | { readonly kind: "rolled-back"; readonly sqlState?: string } | { readonly kind: "uncertain" };

/** Dedicated fresh connection per operation. No retry, environment/configuration,
 * role escalation, RLS bypass, implicit COMMIT or transport default is supplied. */
async function transaction<T>(connector: PostgresConnector, sql: string, params: readonly unknown[], signal: AbortSignal,
  readOnly: boolean, validate: (raw: unknown) => T): Promise<TransactionResult<T>> {
  let session: PostgresSession | undefined;
  let begun = false; let commitSent = false; let discarded = false;
  const discard = () => { if (session && !discarded) { discarded = true; try { session.discard(); } catch { /* sanitized */ } } };
  const onAbort = () => discard();
  try {
    if (signal.aborted) return { kind: "uncertain" };
    session = await connector.connect(signal);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted || session.initialTransactionStatus !== "idle") return { kind: "uncertain" };
    const start = await session.query(readOnly ? BEGIN_READ : BEGIN_WRITE, [], signal);
    if (!acknowledged(start, "BEGIN", "transaction")) return { kind: "uncertain" };
    begun = true;
    if (signal.aborted) return { kind: "uncertain" };
    const value = validate(oneResult(await session.query(sql, params, signal)));
    if (signal.aborted) return { kind: "uncertain" };
    // A lost COMMIT reply is not repaired by sending ROLLBACK or retrying.
    commitSent = true;
    const commit = await session.query("COMMIT", [], signal);
    if (signal.aborted) return { kind: "uncertain" };
    if (acknowledged(commit, "ROLLBACK", "idle")) return { kind: "rolled-back" };
    if (!acknowledged(commit, "COMMIT", "idle")) return { kind: "uncertain" };
    return { kind: "committed", value };
  } catch (error) {
    if (session && begun && !commitSent && !signal.aborted && !discarded) {
      try {
        const rollback = await session.query("ROLLBACK", [], signal);
        if (acknowledged(rollback, "ROLLBACK", "idle") && !signal.aborted) {
          const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
          return { kind: "rolled-back", ...(typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? { sqlState: code } : {}) };
        }
      } catch { /* missing rollback acknowledgement remains uncertain */ }
    }
    return { kind: "uncertain" };
  } finally { signal.removeEventListener("abort", onAbort); discard(); }
}
function snapshot(value: RevocationIntent): RevocationIntent {
  const intent = Object.freeze({ ...value }); if (!validIntent(intent)) throw new Error("Invalid private intent"); return intent;
}

/** Session/user revocation reuses the old core through the new reservation-check
 * wrapper, within the SAME transaction. Reconciliation validates full intent and calls the existing function
 * in an independent READ ONLY transaction, without journal/Auth writes. */
export function createPostgresRevocationDatabase(connector: PostgresConnector): RevocationDatabase {
  return Object.freeze({
    async revoke(value: RevocationIntent, options: TransactionOptions): Promise<RevocationWrite> {
      try {
        const intent = snapshot(value); if (options.isolation !== "read committed") return { kind: "uncertain" };
        const outcome = await transaction(connector, REVOKE, parameters(intent), options.signal, false, raw => {
          const record = parseRecord(json(raw), intent); if (!record) throw new Error("Private record mismatch"); return record;
        });
        return outcome.kind === "committed" ? { kind: "committed", record: outcome.value }
          : outcome.kind === "rolled-back" ? { kind: "rejected", rollback: "confirmed" } : { kind: "uncertain" };
      } catch { return { kind: "uncertain" }; }
    },
    async reconcile(value: RevocationIntent, options: TransactionOptions): Promise<RevocationRead> {
      try {
        const intent = snapshot(value); if (options.isolation !== "read committed") return { kind: "unavailable" };
        const outcome = await transaction(connector, RECONCILE, parameters(intent), options.signal, true, raw => {
          const v = json(raw); const record = parseRecord(v, intent);
          if (record) return record;
          if (v && typeof v === "object" && (v as { state?: unknown }).state === "absent-uncertain") return null;
          throw new Error("Private reconciliation mismatch");
        });
        return outcome.kind !== "committed" ? { kind: "unavailable" }
          : outcome.value ? { kind: "found", snapshot: "committed", record: outcome.value } : { kind: "absent-uncertain" };
      } catch { return { kind: "unavailable" }; }
    },
  });
}

/** Requires the new, unapplied private journal migration. Every returned claim or
 * terminal observation requires a PostgreSQL COMMIT ack. Missing schema/privilege
 * cannot fall back to memory or call the old revoker as a reservation side effect. */
export function createPostgresOperationJournal(connector: PostgresConnector): OperationJournal {
  async function invoke(value: RevocationIntent, sql: string, signal: AbortSignal, allowed: readonly string[], suffix: readonly unknown[] = []) {
    try {
      const intent = snapshot(value);
      return await transaction(connector, sql, [...parameters(intent), ...suffix], signal, false, raw => {
        if (typeof raw !== "string" || !allowed.includes(raw)) throw new Error("Invalid journal reply"); return raw;
      });
    } catch { return { kind: "uncertain" as const }; }
  }
  return Object.freeze<OperationJournal>({
    async reserve(i, signal) {
      const result = await invoke(i, RESERVE, signal, ["reserved", "existing"]);
      return result.kind === "committed" ? result.value as "reserved" | "existing"
        : result.kind === "rolled-back" && result.sqlState === "ZJ010" ? "conflict" : "unavailable";
    },
    async beginAuth(i, signal) {
      if (i.purpose !== "logout") return "conflict";
      const result = await invoke(i, BEGIN_AUTH, signal, ["started", "pending", "succeeded", "failed", "uncertain"]);
      return result.kind === "committed" ? result.value as "started" | "pending" | "succeeded" | "failed" | "uncertain"
        : result.kind === "rolled-back" && result.sqlState === "ZJ010" ? "conflict" : "unavailable";
    },
    async finishAuth(i, progress, signal) {
      if (i.purpose !== "logout" || !["succeeded", "failed", "uncertain"].includes(progress)) return "unavailable";
      const result = await invoke(i, FINISH_AUTH, signal, ["finished"], [progress]);
      return result.kind === "committed" ? "confirmed" : "unavailable";
    },
  });
}
