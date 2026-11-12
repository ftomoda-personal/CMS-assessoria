import { constants, createPublicKey, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";

/** Raw field pairs preserve duplicates. Fetch Headers combines duplicates with a
 * comma, which this parser rejects. Never select the first of multiple values. */
export type HeaderFields = Iterable<readonly [string, string]>;
export function extractBearer(fields: HeaderFields): string | null {
  const values = [...fields].filter(([name]) => name.toLowerCase() === "authorization").map(([, value]) => value);
  if (values.length !== 1) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(values[0]!);
  return match?.[1] ?? null;
}

export interface BearerIdentity {
  readonly userId: string;
  readonly sessionId: string;
  readonly expiresAt: number;
}
export interface JwtPolicy {
  readonly issuer: string;
  readonly audience: string;
  /** Implemented profile is RSA SHA-256 only; no inferred hosted signing policy. */
  readonly algorithms: readonly "RS256"[];
  readonly nowSeconds: () => number;
}
export interface SignatureVerifier {
  /** Synchronous, trusted local verification only; no key URL from token headers. */
  verify(algorithm: "RS256", keyId: string, signed: Uint8Array, signature: Uint8Array): boolean;
}

/** Trusted explicit key snapshot. No fetching, refresh, environment or SDK use. */
export function rsaKeySnapshot(keys: ReadonlyMap<string, KeyObject>): SignatureVerifier {
  const snapshot = new Map<string, KeyObject>();
  for (const [id, input] of keys) {
    const key = input.type === "public" ? input : createPublicKey(input);
    if (!id || input.type !== "public" || key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      throw new Error("Invalid public verification key snapshot");
    }
    snapshot.set(id, key);
  }
  return Object.freeze({ verify(algorithm: "RS256", id: string, signed: Uint8Array, signature: Uint8Array) {
    const key = snapshot.get(id);
    return algorithm === "RS256" && !!key && verify("RSA-SHA256", signed, { key, padding: constants.RSA_PKCS1_PADDING }, signature);
  } });
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function segment(value: string): Buffer {
  const result = Buffer.from(value, "base64url");
  if (result.toString("base64url") !== value) throw new Error("Invalid encoding");
  return result;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export type JwtResult = { readonly kind: "verified"; readonly identity: BearerIdentity } | { readonly kind: "denied" } | { readonly kind: "unavailable" };
export function verifyBearer(token: string, policy: JwtPolicy, verifier: SignatureVerifier): JwtResult {
  try {
    const now = policy.nowSeconds();
    if (!policy.issuer || !policy.audience || !Number.isFinite(now) || !policy.algorithms.length || policy.algorithms.some(a => a !== "RS256")) return { kind: "unavailable" };
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return { kind: "denied" };
    const [head, payload, signature] = token.split(".") as [string, string, string];
    const header = record(JSON.parse(segment(head).toString("utf8")));
    if (!header || header.alg !== "RS256" || !policy.algorithms.includes(header.alg) || typeof header.kid !== "string" || !header.kid
      || Object.keys(header).some(k => !["alg", "kid", "typ"].includes(k)) || (header.typ !== undefined && header.typ !== "JWT")) return { kind: "denied" };
    if (!verifier.verify(header.alg, header.kid, Buffer.from(`${head}.${payload}`, "ascii"), segment(signature))) return { kind: "denied" };
    // Claims become identity only after signature verification of these exact bytes.
    const claims = record(JSON.parse(segment(payload).toString("utf8")));
    if (!claims || claims.iss !== policy.issuer || claims.aud !== policy.audience || claims.role !== "authenticated"
      || !uuid(claims.sub) || !uuid(claims.session_id) || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat)
      || (claims.exp as number) <= now || (claims.iat as number) > now || (claims.iat as number) >= (claims.exp as number)
      || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || (claims.nbf as number) > now))) return { kind: "denied" };
    return { kind: "verified", identity: Object.freeze({ userId: claims.sub, sessionId: claims.session_id, expiresAt: claims.exp as number }) };
  } catch { return { kind: "unavailable" }; }
}
