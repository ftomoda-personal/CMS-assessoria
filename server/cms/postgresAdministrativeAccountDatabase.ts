import { performance } from 'node:perf_hooks';
import type { PostgresConnector, PostgresSession, PostgresResult } from '../als/postgresRevocation.ts';
import type { AdministrativeAccountDatabase, AdministrativeDatabaseRead, AdministrativeAccountProjection } from './administrativeAccountReader.ts';
import { ADMINISTRATIVE_IDENTITY_SQL, STAGING_CURRENT_ACCOUNT_IDENTITY_SQL, isCmsReaderIdentity, ADMINISTRATIVE_SQL_ROLE, CURRENT_ACCOUNT_SQL_ROLE } from './administrativePgConnector.ts';

const BEGIN = 'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY';
const CONFIGURE = `SELECT pg_catalog.set_config('search_path', $1::text, true) AS search_path,
  pg_catalog.set_config('statement_timeout', $2::text, true) AS statement_timeout`;
const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  && v !== '00000000-0000-0000-0000-000000000000';
function record(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
function parse(value: unknown, actor?: string): AdministrativeDatabaseRead {
  const r = record(value);
  if (!r || r.kind !== 'read' || Object.keys(r).length !== 3
    || !Object.hasOwn(r, 'membership') || !Object.hasOwn(r, 'account')) throw Error('Invalid envelope');
  const m = record(r.membership); const a = record(r.account);
  if (r.membership !== null && (!m || Object.keys(m).length !== 1 || !uuid(m.user_id) || (actor !== undefined && m.user_id !== actor))) throw Error('Membership mismatch');
  if (r.account !== null && (!a || Object.keys(a).length !== 3 || !uuid(a.user_id) || (actor !== undefined && a.user_id !== actor)
    || !['administrator', 'student'].includes(a.role as string)
    || !['active', 'pending_invitation', 'disabled'].includes(a.status as string))) throw Error('Account mismatch');
  return Object.freeze({ kind: 'read', membership: m ? Object.freeze({ user_id: m.user_id as string }) : null,
    account: a ? Object.freeze({ user_id: a.user_id, role: a.role, status: a.status }) as AdministrativeAccountProjection : null });
}
function ack(result: PostgresResult, command: string, status: PostgresResult['transactionStatus']) {
  if (result.command !== command || result.transactionStatus !== status) throw Error('Unconfirmed command');
}

/** Disabled server composition. Inject a qualified dedicated-principal connector.
 * This adapter validates actor syntax, not authentication. No actor defaults,
 * Auth calls, SQL retries, pooling, writes or operational configuration.
 * A single STABLE function statement observes one snapshot; COMMIT acknowledgement
 * is required before exposing data. This is not a lock or revocation reservation.
 * Settings are transaction-local and SQL identity is rechecked after BEGIN, before
 * the reader. No persistent session settings are assumed through a pooler.
 * The whole operation has its own deadline even when an injected connector stalls.
 */
interface ReaderDatabaseDependencies {
  readonly connector: PostgresConnector;
  readonly deadlineMs: number;
  readonly shutdownMarginMs: number;
}

export function createPostgresAdministrativeAccountDatabase(deps: ReaderDatabaseDependencies): AdministrativeAccountDatabase {
  return createCmsReaderDatabase(deps, 'administrative');
}

export { CURRENT_ACCOUNT_SQL_ROLE } from './administrativePgConnector.ts';

export function createPostgresCurrentAccountReader(deps: ReaderDatabaseDependencies & { readonly stagingCurrentAccount?: boolean }) {
  const database = createCmsReaderDatabase(deps, 'current', deps.stagingCurrentAccount);
  return async (actorUserId: string, signal: AbortSignal) => {
    const result = await database.readCurrentAdministrator(actorUserId, signal);
    if (result.kind !== 'read') throw Error('Current account read unavailable');
    return { account: result.account, membership: result.membership };
  };
}

function createCmsReaderDatabase(deps: ReaderDatabaseDependencies, reader: 'administrative' | 'current', stagingCurrentAccount = false) {
  const role = reader === 'current' ? CURRENT_ACCOUNT_SQL_ROLE : ADMINISTRATIVE_SQL_ROLE;
  const read = reader === 'current'
    ? 'SELECT cms_private.read_current_account($1::uuid) AS result'
    : 'SELECT cms_private.read_administrative_account($1::uuid) AS result';
  const identitySql = stagingCurrentAccount ? STAGING_CURRENT_ACCOUNT_IDENTITY_SQL : ADMINISTRATIVE_IDENTITY_SQL;
  const { connector, deadlineMs, shutdownMarginMs } = deps;
  return Object.freeze({
    async readCurrentAdministrator(actorUserId: string, signal: AbortSignal): Promise<AdministrativeDatabaseRead> {
      const controller = new AbortController();
      let session: PostgresSession | undefined;
      let discarded = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const started = performance.now();
      const unavailable = { kind: 'unavailable' } as const;
      const discard = () => {
        if (session && !discarded) { discarded = true; try { session.discard(); } catch { /* sanitized */ } }
      };
      const cancel = () => { controller.abort(); discard(); };
      const current = () => {
        if (controller.signal.aborted || performance.now() - started >= deadlineMs) throw Error('Unavailable');
      };
      try {
        if (!uuid(actorUserId) || signal.aborted || !Number.isSafeInteger(deadlineMs)
          || deadlineMs <= 0 || deadlineMs > 2_147_483_647
          || !Number.isSafeInteger(shutdownMarginMs) || shutdownMarginMs < 1
          || 2 * shutdownMarginMs >= deadlineMs) return unavailable;
        signal.addEventListener('abort', cancel, { once: true });
        const timeout = new Promise<AdministrativeDatabaseRead>(resolve => {
          controller.signal.addEventListener('abort', () => resolve(unavailable), { once: true });
          timer = setTimeout(cancel, deadlineMs);
        });
        const work = async (): Promise<AdministrativeDatabaseRead> => {
          // A connector resolving after timeout still has its late session closed.
          session = await connector.connect(controller.signal);
          try {
            current();
            if (session.initialTransactionStatus !== 'idle') throw Error('Non-idle connection');
            const queryTimeoutMs = (session as PostgresSession & { readonly queryTimeoutMs?: unknown }).queryTimeoutMs;
            if (typeof queryTimeoutMs !== 'number' || !Number.isSafeInteger(queryTimeoutMs)
              || queryTimeoutMs > 2_147_483_647 || queryTimeoutMs <= shutdownMarginMs) throw Error('Unqualified query budget');
            ack(await session.query(BEGIN, [], controller.signal), 'BEGIN', 'transaction'); current();
            // One margin for CONFIGURE/IDENTITY and one for termination. No 0
            // timeout (disabled), and never exceed the lease's real query cap.
            const statementTimeoutMs = Math.min(queryTimeoutMs - shutdownMarginMs,
              Math.floor(deadlineMs - (performance.now() - started)) - 2 * shutdownMarginMs);
            if (statementTimeoutMs < 1) throw Error('No remaining statement budget');
            const configured = await session.query(CONFIGURE, ['pg_catalog', `${statementTimeoutMs}ms`], controller.signal); current();
            ack(configured, 'SELECT', 'transaction');
            if (configured.rowCount !== 1 || configured.rows.length !== 1
              || !record(configured.rows[0]) || configured.rows[0].search_path !== 'pg_catalog'
              || typeof configured.rows[0].statement_timeout !== 'string') throw Error('Invalid configuration');
            const identity = await session.query(identitySql, [], controller.signal); current();
            ack(identity, 'SELECT', 'transaction');
            const context = identity.rows[0];
            if (identity.rowCount !== 1 || identity.rows.length !== 1 || !isCmsReaderIdentity(context, role, stagingCurrentAccount)
              || context.read_only !== true || context.isolation !== 'read committed'
              || context.search_path !== 'pg_catalog'
              || context.statement_timeout_ms !== statementTimeoutMs) throw Error('Unqualified transaction');
            // Setup may have consumed its reserve: stop, do not reconfigure/retry.
            if (statementTimeoutMs + shutdownMarginMs > queryTimeoutMs
              || statementTimeoutMs + shutdownMarginMs > Math.floor(deadlineMs - (performance.now() - started))) {
              throw Error('Insufficient remaining query budget');
            }
            const response = await session.query(read, [actorUserId], controller.signal); current();
            ack(response, 'SELECT', 'transaction');
            if (response.rowCount !== 1 || response.rows.length !== 1) throw Error('Invalid rows');
            const row = record(response.rows[0]);
            if (!row || Object.keys(row).length !== 1 || !Object.hasOwn(row, 'result')) throw Error('Invalid result');
            const data = parse(row.result, reader === 'administrative' ? actorUserId : undefined);
            ack(await session.query('COMMIT', [], controller.signal), 'COMMIT', 'idle'); current();
            return data;
          } finally { discard(); }
        };
        const result = await Promise.race([work(), timeout]);
        current(); return result;
      } catch { return unavailable; }
      finally {
        clearTimeout(timer); signal.removeEventListener('abort', cancel); cancel();
        // Socket disposal is not a claim that a missing transaction response was
        // received. All uncertain outcomes stay unavailable; no repair/retry.
      }
    },
  });
}
