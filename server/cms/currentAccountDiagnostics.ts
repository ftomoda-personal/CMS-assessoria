import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const timing = ['deadline_exceeded', 'cancelled', 'unknown'] as const;
export const categories = {
  config_gate: ['config_missing', 'config_invalid', 'ca_invalid'],
  composition: ['composition_failed'],
  auth_claims: ['upstream_unavailable', ...timing],
  auth_user: ['upstream_unavailable', ...timing],
  pg_connect: ['dns_resolution_failed', 'network_unreachable', 'connection_refused',
    'tls_validation_failed', 'tls_handshake_failed', 'sql_auth_rejected', ...timing],
  pg_session_identity: ['identity_mismatch', 'protocol_mismatch', ...timing],
  pg_transaction_setup: ['sql_permission_denied', 'sql_execution_failed', 'identity_mismatch', 'protocol_mismatch', ...timing],
  pg_read_current_account: ['sql_permission_denied', 'sql_function_missing', 'sql_execution_failed', 'result_invalid', ...timing],
  pg_commit: ['sql_execution_failed', 'protocol_mismatch', ...timing],
  http_handler: ['operation_unsupported', ...timing],
} as const;

type Stage = keyof typeof categories;
type RequestStage = Exclude<Stage, 'config_gate' | 'composition'>;
type State = { stage: RequestStage; failure?: { stage: RequestStage; category: string }; done: boolean };
const context = new AsyncLocalStorage<State>();

function emit(stage: Stage, category: string, started: number, request: boolean) {
  try {
    console.warn(JSON.stringify({
      event: 'cms.current_account.unavailable',
      stage,
      category,
      duration_ms: Math.round((performance.now() - started) / 10) * 10,
      ...(request ? { correlation_id: randomBytes(8).toString('hex') } : {}),
    }));
  } catch { /* Diagnostics cannot affect availability. */ }
}

export function initializationFailure<S extends 'config_gate' | 'composition'>(
  stage: S, category: (typeof categories)[S][number], started: number,
) {
  emit(stage, category, started, false);
}

export function diagnosticStage(stage: RequestStage) {
  const state = context.getStore();
  if (state && !state.done) state.stage = stage;
}

export function diagnosticFailure(category: string) {
  const state = context.getStore();
  if (!state || state.done || state.failure) return;
  const stage = state.stage;
  state.failure = { stage, category: (categories[stage] as readonly string[]).includes(category) ? category : 'unknown' };
}

const codeCategories = new Map([
  ['ENOTFOUND', 'dns_resolution_failed'], ['EAI_AGAIN', 'dns_resolution_failed'],
  ['ENETUNREACH', 'network_unreachable'], ['EHOSTUNREACH', 'network_unreachable'],
  ['ECONNREFUSED', 'connection_refused'], ['ETIMEDOUT', 'deadline_exceeded'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_validation_failed'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls_validation_failed'],
  ['SELF_SIGNED_CERT_IN_CHAIN', 'tls_validation_failed'],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls_validation_failed'],
  ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'tls_validation_failed'],
  ['CERT_HAS_EXPIRED', 'tls_validation_failed'],
  ['ERR_SSL_WRONG_VERSION_NUMBER', 'tls_handshake_failed'],
  ['28P01', 'sql_auth_rejected'], ['28000', 'sql_auth_rejected'],
  ['42501', 'sql_permission_denied'], ['42883', 'sql_function_missing'],
  ['57014', 'cancelled'],
  ['XX000', 'sql_execution_failed'], ['42P01', 'sql_execution_failed'],
  ['25P02', 'sql_execution_failed'], ['40001', 'sql_execution_failed'],
]);

export function diagnosticError(error: unknown, fallback = 'unknown') {
  if (!context.getStore()) return;
  try {
    const code = (error as { code?: unknown } | null)?.code;
    diagnosticFailure(typeof code === 'string' ? codeCategories.get(code) ?? 'unknown' : fallback);
  } catch { diagnosticFailure('unknown'); }
}

export function diagnoseCurrentAccount(handler: (request: Request) => Response | Promise<Response>) {
  return (request: Request) => {
    const state: State = { stage: 'http_handler', done: false };
    const started = performance.now();
    return context.run(state, async () => {
      const response = await handler(request);
      state.done = true;
      if (response.status === 503) {
        emit(state.failure?.stage ?? state.stage,
          state.failure?.category ?? (request.signal.aborted ? 'cancelled' : 'unknown'), started, true);
      }
      return response;
    });
  };
}
