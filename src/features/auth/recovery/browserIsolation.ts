import { createRecoveryIsolation, passwordAdmissionKey, recoveryBarrierKey } from "./isolation.ts";
const eventName = "cms-recovery-isolation-change";
export const recoveryIsolation = createRecoveryIsolation(
  { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: key => window.localStorage.removeItem(key) },
  { getItem: key => window.sessionStorage.getItem(key), setItem: (key, value) => window.sessionStorage.setItem(key, value), removeItem: key => window.sessionStorage.removeItem(key) },
  () => window.dispatchEvent(new Event(eventName)),
);
export function subscribeRecoveryIsolation(listener: () => void) {
  const stored = (event: StorageEvent) => { if (event.key === recoveryBarrierKey || event.key === passwordAdmissionKey || event.key === null) listener(); };
  window.addEventListener(eventName, listener); window.addEventListener("storage", stored);
  return () => { window.removeEventListener(eventName, listener); window.removeEventListener("storage", stored); };
}
