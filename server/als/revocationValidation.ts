import type { RevocationIntent, RevocationRecord } from "./revocationContracts.ts";

const uuid = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x) && x !== "00000000-0000-0000-0000-000000000000";
export function validIntent(i: RevocationIntent): boolean {
  return uuid(i.operationId) && uuid(i.userId) && uuid(i.actorSessionId)
    && (i.kind === "session" ? i.sessionId === i.actorSessionId : i.kind === "user" && i.sessionId === null)
    && (i.purpose === "logout" ? i.kind === "session" && (i.authScope === "local" || i.authScope === "global")
      : i.authScope === null && (i.purpose === "session-revocation" ? i.kind === "session" : i.purpose === "membership-generation-revocation" && i.kind === "user"));
}
export function same(a: RevocationIntent, b: RevocationIntent): boolean {
  return a.operationId === b.operationId && a.userId === b.userId && a.actorSessionId === b.actorSessionId
    && a.kind === b.kind && a.sessionId === b.sessionId && a.purpose === b.purpose && a.authScope === b.authScope;
}
export function parseRecord(value: unknown, intent: RevocationIntent): RevocationRecord | null {
  if (!value || typeof value !== "object") return null;
  const r = value as RevocationRecord;
  const generation = (x: unknown): x is string => typeof x === "string" && x.length <= 19 && /^[1-9][0-9]*$/.test(x) && BigInt(x) <= 9223372036854775807n;
  if (r.state !== "recorded" || r.operation_id !== intent.operationId || r.user_id !== intent.userId
    || r.kind !== intent.kind || r.session_id !== intent.sessionId || !Number.isSafeInteger(r.affected) || r.affected < 0) return null;
  if (r.generation_before === null) { if (r.generation_after !== null) return null; }
  else if (!generation(r.generation_before) || !generation(r.generation_after)
    || BigInt(r.generation_after) !== BigInt(r.generation_before) + (intent.kind === "user" ? 1n : 0n)) return null;
  return Object.freeze({ state: r.state, operation_id: r.operation_id, user_id: r.user_id, kind: r.kind,
    session_id: r.session_id, generation_before: r.generation_before, generation_after: r.generation_after, affected: r.affected });
}
