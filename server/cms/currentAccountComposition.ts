import { createAdministrativeOperationAuthority } from './administrativeOperationAuthority.ts';
import { createCmsReaderPgTransport, CURRENT_ACCOUNT_STAGING_REF } from './administrativePgConnector.ts';
import { createSupabaseCurrentAccountService } from './currentAccount.ts';
import { createCmsHandler } from './handler.ts';
import { createPostgresCurrentAccountReader, CURRENT_ACCOUNT_SQL_ROLE } from './postgresAdministrativeAccountDatabase.ts';

interface ProjectConfig {
  readonly projectRef: string;
  readonly publishableKey: string;
  readonly databasePassword: string;
  readonly databaseCa?: string;
  readonly connectionTimeoutMs: number;
  readonly queryTimeoutMs: number;
  readonly databaseDeadlineMs: number;
  readonly shutdownMarginMs: number;
  readonly authorityDeadlineMs: number;
  readonly requestDeadlineMs: number;
}

type Environment = 'staging' | 'production';

function validDuration(value: number) {
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
}

/** Call only from a separately approved server entrypoint. No automatic env
 * lookup, fallback credentials, shared project, or browser configuration.
 * Uses the project-bound direct PostgreSQL host, which must be reachable from
 * the server runtime and independently qualified for TLS and privileges.
 */
export function createCurrentAccountComposition(environment: Environment, config: {
  readonly projectRefs?: Readonly<Record<Environment, string>>;
  readonly project: ProjectConfig;
}) {
  const { project, projectRefs } = config;
  if ((environment !== 'staging' && environment !== 'production')
    || (projectRefs
      ? ![projectRefs.staging, projectRefs.production].every(ref => /^[a-z]{20}$/.test(ref))
        || projectRefs.staging === projectRefs.production || project.projectRef !== projectRefs[environment]
      : environment !== 'staging' || project.projectRef !== CURRENT_ACCOUNT_STAGING_REF)
    || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(project.publishableKey)
    || typeof project.databasePassword !== 'string' || !project.databasePassword
    || (project.databaseCa !== undefined && (typeof project.databaseCa !== 'string' || !project.databaseCa))
    || ![project.connectionTimeoutMs, project.queryTimeoutMs, project.databaseDeadlineMs,
      project.shutdownMarginMs, project.authorityDeadlineMs, project.requestDeadlineMs].every(validDuration)
    || project.shutdownMarginMs >= project.queryTimeoutMs
    || project.connectionTimeoutMs + 2 * project.shutdownMarginMs >= project.databaseDeadlineMs
    || project.databaseDeadlineMs >= project.authorityDeadlineMs
    || project.authorityDeadlineMs >= project.requestDeadlineMs) {
    throw Error('Invalid current account server configuration');
  }

  const stagingCurrentAccount = environment === 'staging' && project.projectRef === CURRENT_ACCOUNT_STAGING_REF;
  const connector = createCmsReaderPgTransport({
    host: `db.${project.projectRef}.supabase.co`,
    port: 5432,
    database: 'postgres',
    connectionUser: CURRENT_ACCOUNT_SQL_ROLE,
    stagingCurrentAccount,
    password: project.databasePassword,
    tls: { ca: project.databaseCa },
    connectionTimeoutMs: project.connectionTimeoutMs,
    queryTimeoutMs: project.queryTimeoutMs,
  }, CURRENT_ACCOUNT_SQL_ROLE);
  const readCurrentAccount = createPostgresCurrentAccountReader({
    connector,
    stagingCurrentAccount,
    deadlineMs: project.databaseDeadlineMs,
    shutdownMarginMs: project.shutdownMarginMs,
  });
  const currentAccount = createSupabaseCurrentAccountService({
    supabaseUrl: `https://${project.projectRef}.supabase.co`,
    publishableKey: project.publishableKey,
    deadlineMs: project.authorityDeadlineMs,
    readCurrentAccount,
  });
  return Object.freeze({
    handler: createCmsHandler({ currentAccount, requestDeadlineMs: project.requestDeadlineMs }),
    authorizeAdministrativeOperation: createAdministrativeOperationAuthority(currentAccount),
  });
}
