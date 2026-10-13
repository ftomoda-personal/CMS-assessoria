import { isVerificationJsonContentType } from "./contentType.ts";
import { parseRemoteVerification, verificationResult } from "../../src/features/partners/logoVerificationContracts.ts";
import type { LocalLogoObservation } from "../../src/features/partners/logoVerificationContracts";
export function verificationBearer(header: string | null): string | undefined {
  return /^Bearer ([^\s]+)$/.exec(header ?? "")?.[1];
}
class HttpFailure extends Error {
  readonly reason: "invalid" | "timeout" | "cancelled";
  constructor(reason: "invalid" | "timeout" | "cancelled") { super("Verification HTTP failure"); this.reason = reason; }
}
/** Read bounded bytes, not characters; reject before retaining an oversized chunk.
 * Content-Length is only an early check. No text()/json()/arrayBuffer() call. */
export async function readVerificationBody(request: Request, maxBytes: number, signal: AbortSignal): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new HttpFailure("invalid");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maxBytes)) throw new HttpFailure("invalid");
  if (signal.aborted) throw new HttpFailure("cancelled");
  if (!request.body) throw new HttpFailure("invalid");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const next = await reader.read();
      if (signal.aborted) throw new HttpFailure("cancelled");
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || next.value.byteLength > maxBytes - total) {
        void reader.cancel().catch(() => {}); throw new HttpFailure("invalid");
      }
      total += next.value.byteLength; chunks.push(next.value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new HttpFailure("invalid"); }
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
export interface VerificationHttpOptions {
  readonly allowedOrigins: readonly string[];
  readonly maxBodyBytes: number;
  readonly deadlineMs: number;
  /** Deterministic injection for tests; production must actually schedule expiry. */
  readonly scheduleTimeout?: (expire: () => void, ms: number) => () => void;
}
/** Isolated wrapper factory, never a public entrypoint. CORS is not authentication.
 * The inner handler still must enforce auth, membership and mandatory admission.
 * Abort is propagated; adapters must add upstream deadlines. A late result is discarded.
 */
export function createVerificationHttpSecurity(handler: (request: Request) => Promise<Response>, options: VerificationHttpOptions) {
  if (!Number.isSafeInteger(options.maxBodyBytes) || options.maxBodyBytes < 1 || !Number.isSafeInteger(options.deadlineMs) || options.deadlineMs < 1) throw new Error("Invalid HTTP security configuration");
  const origins = new Set(options.allowedOrigins);
  if (!origins.size || [...origins].some(origin => { try { const u = new URL(origin); return !["https:", "http:"].includes(u.protocol) || u.origin !== origin; } catch { return true; } })) throw new Error("Invalid origin configuration");
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin"); const allowedOrigin = origin !== null && origins.has(origin) ? origin : undefined;
    const headers = () => {
      const h = new Headers({ "Cache-Control": "no-store", "Vary": "Origin", "Content-Type": "application/json" });
      if (allowedOrigin) h.set("Access-Control-Allow-Origin", allowedOrigin);
      return h;
    };
    const respond = (observation: LocalLogoObservation, status: number) => new Response(JSON.stringify(verificationResult(observation)), { status, headers: headers() });
    if (!allowedOrigin) return respond({ kind: "authorization-denied" }, 403);
    if (request.method === "OPTIONS") {
      const requestedHeaders = (request.headers.get("access-control-request-headers") ?? "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
      if (request.headers.get("access-control-request-method") !== "POST" || requestedHeaders.some(h => !["authorization", "content-type"].includes(h))) return respond({ kind: "invalid-request" }, 400);
      const h = headers(); h.set("Access-Control-Allow-Methods", "POST"); h.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      return new Response(null, { status: 204, headers: h });
    }
    if (request.method !== "POST" || !isVerificationJsonContentType(request.headers.get("content-type"))) return respond({ kind: "invalid-request" }, 400);
    if (!verificationBearer(request.headers.get("authorization"))) return respond({ kind: "authorization-denied" }, 403);
    const controller = new AbortController(); let timedOut = false;
    const cancel = () => { controller.abort(); };
    request.signal.addEventListener("abort", cancel, { once: true });
    if (request.signal.aborted) controller.abort();
    let removeAbortListener = () => {};
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(new HttpFailure(timedOut ? "timeout" : "cancelled"));
      if (controller.signal.aborted) onAbort(); else { controller.signal.addEventListener("abort", onAbort, { once: true }); removeAbortListener = () => controller.signal.removeEventListener("abort", onAbort); }
    });
    const schedule = options.scheduleTimeout ?? ((fn, ms) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); });
    let clear: (() => void) | undefined;
    try {
      clear = schedule(() => { timedOut = true; controller.abort(); }, options.deadlineMs);
      const work = async () => {
        const body = await readVerificationBody(request, options.maxBodyBytes, controller.signal);
        if (controller.signal.aborted) throw new HttpFailure(timedOut ? "timeout" : "cancelled");
        const inner = new Request(request.url, { method: "POST", headers: request.headers, body, signal: controller.signal });
        const response = await handler(inner);
        if (controller.signal.aborted) throw new HttpFailure(timedOut ? "timeout" : "cancelled");
        const value = parseRemoteVerification(await response.json());
        if (controller.signal.aborted) throw new HttpFailure(timedOut ? "timeout" : "cancelled");
        const expectedStatus = value.kind === "invalid-request" ? 400 : value.kind === "authorization-denied" ? 403
          : value.kind === "invalid-response" ? 502 : value.kind === "service-failure"
            ? value.reason === "rate-limited" || value.reason === "concurrency-limited" ? 429 : 503 : 200;
        if (response.status !== expectedStatus) return respond({ kind: "invalid-response" }, 502);
        return new Response(JSON.stringify(value), { status: value.kind === "invalid-response" ? 502 : response.status, headers: headers() });
      };
      return await Promise.race([aborted, work()]);
    } catch (error) {
      if (timedOut) return respond({ kind: "service-failure", reason: "unavailable" }, 504);
      if (request.signal.aborted || error instanceof HttpFailure && error.reason === "cancelled") return respond({ kind: "cancelled" }, 499);
      if (error instanceof HttpFailure && error.reason === "invalid") return respond({ kind: "invalid-request" }, 400);
      return respond({ kind: "service-failure", reason: "unavailable" }, 503);
    } finally { clear?.(); removeAbortListener(); request.signal.removeEventListener("abort", cancel); }
  };
}
