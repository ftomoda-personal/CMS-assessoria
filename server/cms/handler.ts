import { diagnosticFailure } from './currentAccountDiagnostics.ts';
import type { createCurrentAccountService } from './currentAccount.ts';
import type { CmsInfrastructureError, CmsInfrastructureResponse } from "./contracts.ts";

function respond(error: CmsInfrastructureError, status: number, head: boolean, allow?: string): Response {
  const body: CmsInfrastructureResponse = { error };
  return new Response(head ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(allow ? { Allow: allow } : {}),
    },
  });
}

/** Inert infrastructure only. Never reads headers/body or dispatches work. */
export function handleCmsRequest(request: Request): Response {
  const head = request.method === "HEAD";
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return respond("invalid_request", 400, head);
  }
  if (pathname !== "/api/cms") return respond("not_found", 404, head);
  if (request.method !== "POST") return respond("method_not_allowed", 405, head, "POST");
  return respond("backend_unavailable", 503, false);
}


export interface CmsHandlerDependencies {
  readonly currentAccount: Pick<ReturnType<typeof createCurrentAccountService>, 'query'>;
  /** Explicit request budget, including body parsing and service observation. */
  readonly requestDeadlineMs: number;
}
/** Functional HTTP composition for a separately qualified read-only account
 * channel. The deployed export above remains unavailable until that binding is
 * reviewed. No implicit .env, grants, SQL function, service-role or project exists.
 */
export function createCmsHandler(deps: CmsHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    const baseline = handleCmsRequest(request);
    if (baseline.status !== 503) return baseline;
    if (!deps?.currentAccount || !Number.isSafeInteger(deps.requestDeadlineMs)
      || deps.requestDeadlineMs < 1 || deps.requestDeadlineMs > 2_147_483_647 || request.signal.aborted) return baseline;
    const controller = new AbortController();
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finish: () => void = () => {};
    const cancel = () => { controller.abort(); finish(); };
    const cancelRequest = () => { diagnosticFailure('cancelled'); cancel(); };
    request.signal.addEventListener('abort', cancelRequest, { once: true });
    const timeout = new Promise<Response>(resolve => {
      finish = () => resolve(respond('backend_unavailable', 503, false));
      timer = setTimeout(() => { diagnosticFailure('deadline_exceeded'); cancel(); }, deps.requestDeadlineMs);
    });
    const work = async (): Promise<Response> => {
      if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
        return respond('invalid_request', 400, false);
      if (!request.body) return respond('invalid_request', 400, false);
      const reader = request.body.getReader();
      const stopReading = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', stopReading, { once: true });
      let bytes = new Uint8Array(0);
      try {
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (bytes.length + chunk.value.length > 2048) return respond('invalid_request', 400, false);
          const next = new Uint8Array(bytes.length + chunk.value.length);next.set(bytes);next.set(chunk.value, bytes.length);bytes = next;
        }
      } finally {
        controller.signal.removeEventListener('abort', stopReading);
        void reader.cancel().catch(() => {});reader.releaseLock();
      }
      if (controller.signal.aborted || performance.now() - started >= deps.requestDeadlineMs) return respond('backend_unavailable', 503, false);
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { return respond('invalid_request', 400, false); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return respond('invalid_request', 400, false);
      const input = value as Record<string, unknown>;
      if (input.operation !== 'current-account') {
        diagnosticFailure('operation_unsupported');
        return respond('backend_unavailable', 503, false);
      }
      if (Object.keys(input).length !== 1) return respond('invalid_request', 400, false);
      const result = await deps.currentAccount.query(request.headers, controller.signal);
      if (controller.signal.aborted || performance.now() - started >= deps.requestDeadlineMs) return respond('backend_unavailable', 503, false);
      if (result.kind === 'unauthenticated') return respond('unauthenticated', 401, false);
      if (result.kind === 'forbidden') return respond('forbidden', 403, false);
      if (result.kind !== 'current') return respond('backend_unavailable', 503, false);
      // Project known fields only; never echo a dependency's extra values.
      return new Response(JSON.stringify({ account: { userId: result.account.userId,
        role: result.account.role, status: result.account.status } }), { status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff' } });
    };
    try {
      const result = await Promise.race([work(), timeout]);
      return controller.signal.aborted || performance.now() - started >= deps.requestDeadlineMs
        ? respond('backend_unavailable', 503, false) : result;
    }
    catch { return respond('backend_unavailable', 503, false); }
    finally { clearTimeout(timer);request.signal.removeEventListener('abort', cancelRequest);controller.abort(); }
  };
}
