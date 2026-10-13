export interface LogoVerificationRequest { readonly version: 1; readonly objectPath: string }
export interface ObservedLogoMetadata { readonly sizeBytes?: number; readonly contentType?: "image/png" | "image/jpeg"; readonly createdAt?: string; readonly lastModifiedAt?: string }
export type RemoteLogoObservation =
  | { readonly kind: "object-observed"; readonly metadata: ObservedLogoMetadata }
  | { readonly kind: "object-not-observed"; readonly reason: "storage-reported-not-found"; readonly earlierUploadMayStillBeInFlight: true }
  | { readonly kind: "authorization-denied" }
  | { readonly kind: "inconclusive"; readonly reason: "unclassified-storage-response" }
  | { readonly kind: "service-failure"; readonly reason: "unavailable" | "rate-limited" | "concurrency-limited" | "abuse-control-unavailable" | "verification-access" }
  | { readonly kind: "invalid-request" | "invalid-response" };
export type LocalLogoObservation = RemoteLogoObservation | { readonly kind: "session-interrupted" | "cancelled" };
export const verificationInvariants = Object.freeze({ version: 1 as const, retryAuthorization: "none" as const, writes: "blocked" as const, storage: "preserve" as const, historicalAttribution: "unestablished" as const, databasePersistence: "unestablished" as const });
export type LogoVerificationResult = LocalLogoObservation & typeof verificationInvariants;
export function verificationResult(observation: LocalLogoObservation): LogoVerificationResult { return Object.freeze({ ...observation, ...verificationInvariants }); }
export function objectRecord(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
export function canonicalLogoPath(value: unknown): value is string { return typeof value === "string" && /^logos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/.exec(value)?.[0] === value; }
export function validVerificationRequest(value: unknown): value is LogoVerificationRequest {
  const r = objectRecord(value); return !!r && Object.keys(r).length === 2 && r.version === 1 && canonicalLogoPath(r.objectPath);
}
export function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match;
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= days[Number(month) - 1] && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60;
}
export function validObservedMetadata(value: unknown): value is ObservedLogoMetadata {
  const m = objectRecord(value); if (!m || Object.keys(m).some(k => !["sizeBytes", "contentType", "createdAt", "lastModifiedAt"].includes(k))) return false;
  return (!Object.hasOwn(m, "sizeBytes") || typeof m.sizeBytes === "number" && Number.isSafeInteger(m.sizeBytes) && m.sizeBytes >= 0)
    && (!Object.hasOwn(m, "contentType") || ["image/png", "image/jpeg"].includes(m.contentType as string))
    && (!Object.hasOwn(m, "createdAt") || validTimestamp(m.createdAt)) && (!Object.hasOwn(m, "lastModifiedAt") || validTimestamp(m.lastModifiedAt));
}
/** Strict wire validation; local interruption/cancellation never come from the server. */
export function parseRemoteVerification(value: unknown): LogoVerificationResult {
  const r = objectRecord(value);
  if (!r || Object.entries(verificationInvariants).some(([k, v]) => r[k] !== v)) return verificationResult({ kind: "invalid-response" });
  let fields: string[] = [];
  switch (r.kind) {
    case "object-observed": if (!validObservedMetadata(r.metadata)) return verificationResult({ kind: "invalid-response" }); fields = ["metadata"]; break;
    case "object-not-observed": if (r.reason !== "storage-reported-not-found" || r.earlierUploadMayStillBeInFlight !== true) return verificationResult({ kind: "invalid-response" }); fields = ["reason", "earlierUploadMayStillBeInFlight"]; break;
    case "authorization-denied": case "invalid-request": case "invalid-response": break;
    case "inconclusive": if (r.reason !== "unclassified-storage-response") return verificationResult({ kind: "invalid-response" }); fields = ["reason"]; break;
    case "service-failure": if (!["unavailable", "rate-limited", "concurrency-limited", "abuse-control-unavailable", "verification-access"].includes(r.reason as string)) return verificationResult({ kind: "invalid-response" }); fields = ["reason"]; break;
    default: return verificationResult({ kind: "invalid-response" });
  }
  if (Object.keys(r).some(k => ![...Object.keys(verificationInvariants), "kind", ...fields].includes(k))) return verificationResult({ kind: "invalid-response" });
  return r.kind === "object-observed" ? verificationResult({ kind: "object-observed", metadata: Object.freeze({ ...r.metadata as ObservedLogoMetadata }) }) : verificationResult(r as unknown as RemoteLogoObservation);
}
