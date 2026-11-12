/** Transient bearer material. Never persist this value, put it in props/history,
 * diagnostics or infer authorization from it. Only verifyOtp can establish it. */
export type RecoveryLink = { kind: "token"; tokenHash: string } | { kind: "invalid" };
export function parseRecoveryLink(url: URL): RecoveryLink {
  const query = url.searchParams;
  if (!/^\/password-recovery\/?$/.test(url.pathname) || url.hash ||
      query.getAll("type").length !== 1 || query.get("type") !== "recovery" ||
      query.getAll("token_hash").length !== 1 ||
      [...query.keys()].some(key => !["type", "token_hash"].includes(key))) return { kind: "invalid" };
  const tokenHash = query.get("token_hash")!;
  return /^[a-zA-Z0-9_-]{32,512}$/.test(tokenHash) ? { kind: "token", tokenHash } : { kind: "invalid" };
}
/** Capture before any rendering/import of CMS modules, then scrub synchronously.
 * The caller must consume once and clear the returned token after verification.
 * Production remains disabled and discards callbacks without calling this. */
export function captureRecoveryCallback(url: URL, scrub: () => void): RecoveryLink {
  const link = parseRecoveryLink(url);
  scrub();
  return link;
}
