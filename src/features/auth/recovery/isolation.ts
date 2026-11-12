export const recoveryBarrierKey = "xpto-cms:recovery-isolation:v1";
export const passwordAdmissionKey = "xpto-cms:password-admission:v1";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SessionIdentity = { user: { id: string }; access_token: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function newEpoch() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
/** Correlation only, not JWT verification or server authorization. Used only with
 * the session returned by an explicit password login; cms_admins still authorizes. */
function sessionIdentity(session: SessionIdentity) {
  try {
    const encoded = session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(encoded));
    return claims.sub === session.user.id && uuid.test(claims.sub) && uuid.test(claims.session_id)
      ? { userId: claims.sub as string, sessionId: claims.session_id as string } : null;
  } catch { return null; }
}
export function createRecoveryIsolation(storage: Store, tab: Store, changed: () => void = () => {}, epoch = newEpoch) {
  let volatileBarrier: string | null = null;
  function barrier(): string | null {
    try {
      const raw = storage.getItem(recoveryBarrierKey);
      if (volatileBarrier) return volatileBarrier;
      if (raw === null) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed.epoch === "string" && /^[a-f0-9]{32}$/.test(parsed.epoch) ? parsed.epoch : "unavailable";
    } catch { return "unavailable"; }
  }
  function allows(session: SessionIdentity | null) {
    const current = barrier();
    if (current === null) return true; // Existing normal restoration is unchanged.
    if (current === "unavailable" || !session) return false;
    try {
      const admission = JSON.parse(tab.getItem(passwordAdmissionKey) ?? "null");
      const identity = sessionIdentity(session);
      return Boolean(identity && admission?.epoch === current && admission.userId === identity.userId && admission.sessionId === identity.sessionId);
    } catch { return false; }
  }
  return {
    allows,
    snapshot() { try { return `${barrier() ?? "normal"}|${tab.getItem(passwordAdmissionKey) ?? ""}`; } catch { return "unavailable"; } },
    begin() {
      const next = epoch();
      try {
        tab.removeItem(passwordAdmissionKey);
        storage.setItem(recoveryBarrierKey, JSON.stringify({ epoch: next }));
        if (storage.getItem(recoveryBarrierKey) !== JSON.stringify({ epoch: next })) throw new Error("Storage unavailable");
        volatileBarrier = null;
      } catch { volatileBarrier = "unavailable"; }
      changed();
      return barrier() !== "unavailable";
    },
    loginAttempt() { const current = barrier(); return current === "unavailable" ? null : { epoch: current }; },
    admitPasswordLogin(session: SessionIdentity, attempt: { epoch: string | null }) {
      const current = barrier();
      if (current === "unavailable" || current !== attempt.epoch) return false;
      if (current === null) return true;
      const identity = sessionIdentity(session);
      if (!identity) return false;
      try {
        const value = JSON.stringify({ epoch: current, ...identity });
        tab.setItem(passwordAdmissionKey, value);
        if (tab.getItem(passwordAdmissionKey) !== value || barrier() !== current) return false;
        changed(); return allows(session);
      } catch { return false; }
    },
  };
}
