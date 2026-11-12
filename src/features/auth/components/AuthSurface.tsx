import type { ReactNode } from "react";
import "../login.css";

/** Authentication designs intentionally keep their own dark theme. */
export function AuthSurface({ recovery = false, children }: { recovery?: boolean; children: ReactNode }) {
  return <main className={`login-page${recovery ? " login-page--recovery" : ""}`} data-theme="dark">{children}</main>;
}
