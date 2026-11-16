import { diagnosticError, diagnosticFailure, diagnosticStage } from './currentAccountDiagnostics.ts';
import { Socket } from "node:net";
import { performance } from "node:perf_hooks";
import { Client } from "pg";
import type { ClientConfig, QueryConfig } from "pg";
import type { PostgresConnector, PostgresResult, PostgresSession } from "../als/postgresRevocation.ts";

export const ADMINISTRATIVE_SQL_ROLE = 'cms_admin_reader_runtime';
export const CURRENT_ACCOUNT_SQL_ROLE = 'cms_current_account_runtime';
export const CURRENT_ACCOUNT_STAGING_REF = 'uhgeboelkbygidmhlugh';
export const CURRENT_ACCOUNT_STAGING_SESSION_POOLER = Object.freeze({
  host: 'aws-1-sa-east-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  connectionUser: `${CURRENT_ACCOUNT_SQL_ROLE}.${CURRENT_ACCOUNT_STAGING_REF}`,
});
const connectionUser = 'cms_admin_reader_runtime.uhgeboelkbygidmhlugh';
const poolerHost = 'aws-1-sa-east-1.pooler.supabase.com';

/** Shared by the initial check and the in-transaction check. No business calls. */
const unexpectedMemberships = 'EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE r.oid IN (m.member, m.roleid, m.grantor))';
function identitySql(membershipCheck: string) {
  return `SELECT current_user AS role, session_user AS login,
  pg_catalog.current_database() AS database, r.rolcanlogin,
  r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolinherit,
  ${membershipCheck} AS memberships,
  pg_catalog.current_setting('transaction_read_only') = 'on' AS read_only,
  pg_catalog.current_setting('transaction_isolation') AS isolation,
  pg_catalog.current_setting('search_path') AS search_path,
  (EXTRACT(EPOCH FROM pg_catalog.current_setting('statement_timeout')::interval) * 1000)::integer AS statement_timeout_ms
  FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;
}

export const ADMINISTRATIVE_IDENTITY_SQL = identitySql(unexpectedMemberships);

export const STAGING_CURRENT_ACCOUNT_IDENTITY_SQL = identitySql(`(
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    m.roleid = r.oid, m.member = 'postgres'::pg_catalog.regrole, m.grantor::pg_catalog.int8,
    m.admin_option, m.inherit_option, m.set_option
  ))
  FROM pg_catalog.pg_auth_members m WHERE r.oid IN (m.member, m.roleid, m.grantor)
)`);

function hasApprovedStagingMembership(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const [membership] = value;
  if (!Array.isArray(membership) || membership.length !== 6) return false;
  const [grantedRuntime, memberIsPostgres, grantor, admin, inherit, set] = membership;
  return grantedRuntime === true && memberIsPostgres === true && grantor === 10
    && admin === true && inherit === false && set === false;
}

/** Identity is fixed SQL authority, never the pooler's tenant-qualified username. */
export function isAdministrativeIdentity(value: unknown): value is Record<string, unknown> {
  return isCmsReaderIdentity(value, ADMINISTRATIVE_SQL_ROLE);
}

export function isCmsReaderIdentity(value: unknown, role: string, stagingCurrentAccount = false): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.role === role && row.login === role
    && row.database === 'postgres' && row.rolcanlogin === true
    && [row.rolsuper, row.rolbypassrls, row.rolcreaterole, row.rolcreatedb,
      row.rolreplication, row.rolinherit].every(v => v === false)
    && (stagingCurrentAccount
      ? role === CURRENT_ACCOUNT_SQL_ROLE && hasApprovedStagingMembership(row.memberships)
      : row.memberships === false);
}

/** Trusted server-only staging profile. No HTTP configuration, DSN/env loader or fallback. */
export interface AdministrativePgConnectorConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly connectionUser: "cms_admin_reader_runtime.uhgeboelkbygidmhlugh";
  readonly password: string;
  readonly tls: { readonly ca?: string; readonly servername?: string };
  readonly connectionTimeoutMs: number;
  readonly queryTimeoutMs: number;
}
function fail(code?: unknown): Error {
  return Object.assign(new Error("PostgreSQL transport unavailable"),
    typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? { code } : {});
}
function status(client: AdministrativePgTransport): PostgresResult["transactionStatus"] {
  switch (client.getTransactionStatus()) {
    case "I": return "idle";
    case "T": return "transaction";
    case "E": return "failed";
    default: throw fail();
  }
}
function duration(value: number): boolean { return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647; }
function rejectAmbientStartupOptions(): void {
  // pg 8.23.0 falls back to PGOPTIONS when options is omitted OR an empty string.
  // Reject rather than mutate global environment or forward unreviewed settings.
  const options = process.env.PGOPTIONS;
  if (options !== undefined && options !== '') throw fail();
}

/** Injectable transport seam for offline fakes; production defaults to pg.
 * Trusted server code only. Never accept a request-supplied factory. */
export interface AdministrativePgTransport {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  on(event: 'error' | 'end', listener: () => void): unknown;
  getTransactionStatus(): string | null;
  query(config: QueryConfig): Promise<{ command: string; rowCount: number | null; rows: Record<string, unknown>[] }>;
}
export type AdministrativePgTransportFactory = (config: ClientConfig & { pipeline: false }) => AdministrativePgTransport;

/** pg 8.23.0, Node 24 server runtime. A fresh Client/socket for every lease.
 * No pool, pipeline, implicit transaction, retry, role switch or Auth integration.
 * Query resolution is followed by actual ReadyForQuery status; COMMIT command
 * acknowledgement is checked by the administrative database adapter.
 */
export function createAdministrativePgConnector(input: AdministrativePgConnectorConfig,
  transportFactory: AdministrativePgTransportFactory = config => new Client(config)): PostgresConnector {
  if (!input || input.host !== poolerHost || input.port !== 6543 || input.database !== 'postgres'
    || input.connectionUser !== connectionUser || typeof input.password !== "string" || !input.password
    || Object.keys(input).some(k => !['host', 'port', 'database', 'connectionUser', 'password', 'tls',
      'connectionTimeoutMs', 'queryTimeoutMs'].includes(k))
    || !duration(input.connectionTimeoutMs) || !duration(input.queryTimeoutMs)
    || (!input.tls || typeof input.tls !== "object" || Array.isArray(input.tls)
      || Object.keys(input.tls).some(k => k !== 'ca' && k !== 'servername')
      || (input.tls.ca !== undefined && (typeof input.tls.ca !== 'string' || !input.tls.ca))
      || (input.tls.servername !== undefined && input.tls.servername !== poolerHost))) throw fail();
  return createCmsReaderPgTransport(input, ADMINISTRATIVE_SQL_ROLE, transportFactory);
}

export function createCmsReaderPgTransport(input: Omit<AdministrativePgConnectorConfig, 'connectionUser'> & {
  readonly connectionUser: string;
  readonly stagingCurrentAccount?: boolean;
  readonly stagingSessionPooler?: boolean;
}, role: string, transportFactory: AdministrativePgTransportFactory = config => new Client(config)): PostgresConnector {
  if (input.stagingSessionPooler && !input.stagingCurrentAccount) throw fail();
  if (input.stagingCurrentAccount) {
    const endpoint = input.stagingSessionPooler ? CURRENT_ACCOUNT_STAGING_SESSION_POOLER : {
      host: `db.${CURRENT_ACCOUNT_STAGING_REF}.supabase.co`,
      port: 5432, database: 'postgres', connectionUser: role,
    };
    if (role !== CURRENT_ACCOUNT_SQL_ROLE || input.host !== endpoint.host
      || input.port !== endpoint.port || input.database !== endpoint.database
      || input.connectionUser !== endpoint.connectionUser
      || (input.stagingSessionPooler && !input.tls.ca)) throw fail();
  }
  const identitySql = input.stagingCurrentAccount ? STAGING_CURRENT_ACCOUNT_IDENTITY_SQL : ADMINISTRATIVE_IDENTITY_SQL;
  rejectAmbientStartupOptions();
  const config = Object.freeze({ ...input, tls: Object.freeze({ ca: input.tls.ca, servername: input.host }) });
  return Object.freeze({
    async connect(signal: AbortSignal): Promise<PostgresSession> {
      if (signal.aborted) throw fail();
      rejectAmbientStartupOptions();
      const socket = new Socket();
      const client = transportFactory({
        host: config.host, port: config.port, database: config.database, user: config.connectionUser,
        password: config.password, ssl: { ...config.tls, rejectUnauthorized: true },
        sslnegotiation: "postgres", stream: () => socket, pipeline: false,
        application_name: role === ADMINISTRATIVE_SQL_ROLE ? "cms-administrative-reader" : "cms-current-account",
        client_encoding: "UTF8",
        connectionTimeoutMillis: config.connectionTimeoutMs,
        // search_path/statement_timeout are set and verified only after BEGIN.
      });
      let closed = false; let busy = false;
      const discard = () => {
        if (closed) return;
        closed = true;
        // Own the underlying socket so even idle/network-partitioned sessions
        // cannot hang in graceful shutdown. Destruction never proves rollback.
        socket.destroy();
        void client.end().catch(() => { /* sanitized; never retry */ });
      };
      client.on("error", discard);
      client.on("end", () => { closed = true; socket.destroy(); });
      async function bounded<T>(operation: () => Promise<T>, abort: AbortSignal, timeout: number): Promise<T> {
        if (closed || abort.aborted) { discard(); throw fail(); }
        const started = performance.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        try {
          const result = await Promise.race([
            new Promise<never>((_resolve, reject) => {
              onAbort = () => { discard(); reject(fail()); };
              abort.addEventListener("abort", onAbort, { once: true });
              timer = setTimeout(() => { diagnosticFailure('deadline_exceeded'); onAbort?.(); }, timeout);
            }),
            Promise.resolve().then(() => {
              if (closed || abort.aborted) throw fail();
              return operation();
            }),
          ]);
          if (closed || abort.aborted || performance.now() - started >= timeout) { discard(); throw fail(); }
          return result;
        } catch (error) {
          discard();
          diagnosticError(error, abort.aborted ? 'cancelled' : 'unknown');
          throw fail();
        } finally {
          clearTimeout(timer);
          if (onAbort) abort.removeEventListener("abort", onAbort);
        }
      }
      try {
        diagnosticStage('pg_connect');
        await bounded(() => client.connect(), signal, config.connectionTimeoutMs);
        diagnosticStage('pg_session_identity');
        if (status(client) !== "idle") { diagnosticFailure('protocol_mismatch'); throw fail(); }
        const identity = await bounded(() => client.query({ text: identitySql,
          values: [], queryMode: 'extended' } as QueryConfig), signal, config.queryTimeoutMs);
        const row = identity.rows[0];
        if (identity.command !== "SELECT" || identity.rowCount !== 1 || identity.rows.length !== 1 || status(client) !== "idle") { diagnosticFailure('protocol_mismatch'); throw fail(); }
        if (!isCmsReaderIdentity(row, role, config.stagingCurrentAccount)) { diagnosticFailure('identity_mismatch'); throw fail(); }
        return Object.freeze<PostgresSession & { readonly queryTimeoutMs: number }>({
          initialTransactionStatus: "idle", discard,
          // Trusted lease metadata lets the adapter cap its server timeout below
          // the actual client query limit, without changing shared ALS contracts.
          queryTimeoutMs: config.queryTimeoutMs,
          async query(sql, parameters, abort) {
            if (closed || busy) { discard(); throw fail(); }
            busy = true;
            try {
              // Extended protocol enforces a single statement, including controls.
              const query: QueryConfig & { queryMode: "extended" } = { text: sql, values: [...parameters], queryMode: "extended" };
              const result = await bounded(() => client.query(query), abort, config.queryTimeoutMs);
              if (Array.isArray(result)) { discard(); throw fail(); }
              return { command: result.command, transactionStatus: status(client), rows: result.rows, rowCount: result.rowCount };
            } finally { busy = false; }
          },
        });
      } catch { discard(); throw fail(); }
    },
  });
}
