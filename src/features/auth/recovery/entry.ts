export const recoveryPath = "/password-recovery";
/** A routing quarantine, never proof of a valid recovery context. Ambiguous Auth
 * callbacks also fail closed instead of entering the ordinary Auth client. */
export function isRecoveryEntry(url: URL) {
  if (/^\/password-recovery(?:\/|$)/.test(url.pathname)) return true;
  const query = url.searchParams, hash = new URLSearchParams(url.hash.slice(1));
  return [query, hash].some(params => params.get("type") === "recovery" || ["access_token", "refresh_token", "token_hash", "code", "error", "error_code", "error_description"].some(key => params.has(key)));
}
