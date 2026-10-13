import { assertSessionContinuity, createSessionContinuityGuard, MutationError } from "../../lib/supabase/mutation.ts";
import type { MutationOptions } from "../../lib/supabase/mutation";
import type { ReadClient } from "../../lib/supabase/readDataset";
import { parseRemoteVerification, validVerificationRequest, verificationResult } from "./logoVerificationContracts.ts";
import type { LogoVerificationRequest, LogoVerificationResult } from "./logoVerificationContracts";
export interface LogoVerificationTransport {
  /** Trusted configured endpoint only. Implementations must send one request, no retries,
   * and return decoded body even for typed non-2xx responses. Never log the token. */
  request(input: LogoVerificationRequest, options: { readonly token: string; readonly signal?: AbortSignal }): Promise<unknown>;
}
/** Isolated DI client: no singleton, UI wiring or historical capability recovery. */
export function createGuardedLogoVerification(client: ReadClient, transport: LogoVerificationTransport) {
  return {
    async verify(input: LogoVerificationRequest, options: MutationOptions = {}): Promise<LogoVerificationResult> {
      if (!validVerificationRequest(input)) return verificationResult({ kind: "invalid-request" });
      const request = { version: 1 as const, objectPath: input.objectPath };
      let guard = options.sessionGuard;
      try {
        guard ??= await createSessionContinuityGuard(client, options);
        await assertSessionContinuity(guard, client, options.signal);
        const session = await client.auth.getSession();
        if (session.error || !session.data.session) return verificationResult({ kind: "authorization-denied" });
        const token = session.data.session.access_token;
        await assertSessionContinuity(guard, client, options.signal);
        const response = await transport.request(request, { token, signal: options.signal });
        await assertSessionContinuity(guard, client, options.signal);
        return parseRemoteVerification(response);
      } catch (error) {
        if (options.signal?.aborted) return verificationResult({ kind: "cancelled" });
        if (guard) {
          try { await assertSessionContinuity(guard, client, options.signal); }
          catch { return verificationResult({ kind: options.signal?.aborted ? "cancelled" : "session-interrupted" }); }
        }
        if (error instanceof MutationError) {
          if (error.kind === "authorization") return verificationResult({ kind: "authorization-denied" });
          if (error.kind === "stale") return verificationResult({ kind: "session-interrupted" });
          if (error.kind === "cancelled") return verificationResult({ kind: "cancelled" });
        }
        return verificationResult({ kind: "service-failure", reason: "unavailable" });
      }
    },
  };
}
