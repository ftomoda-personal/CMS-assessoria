import { lazy, StrictMode, Suspense, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "@ftomoda/spectra-design-system/tokens.css";
import "./index.css";
import { isRecoveryEntry, recoveryPath } from "./features/auth/recovery/entry";
import { recoveryIsolation } from "./features/auth/recovery/browserIsolation";

// These imports execute only in the selected branch. Recovery never imports App,
// the shared client, AuthProvider or CmsDataProvider.
const App = lazy(() => import("./app/App"));
const RecoveryEntry = lazy(() => import("./features/auth/recovery/RecoveryEntry"));
function prepareEntry() {
  if (isRecoveryEntry(new URL(window.location.href))) {
    recoveryIsolation.begin();
    // No credentials/codes are retained in routing state, history or React props.
    window.history.replaceState(null, "", recoveryPath);
  } else if (window.location.pathname === "/") window.history.replaceState(null, "", "/offers");
}
prepareEntry();
const listeners = new Set<() => void>();
window.addEventListener("popstate", () => { prepareEntry(); listeners.forEach(listener => listener()); });
export function Bootstrap() {
  const recovery = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => isRecoveryEntry(new URL(window.location.href)));
  return <Suspense fallback={<div className="auth-loading" role="status">Carregando…</div>}>{recovery ? <RecoveryEntry /> : <App />}</Suspense>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Bootstrap /></StrictMode>);
