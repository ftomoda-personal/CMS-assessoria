import type { ReactNode } from "react";
import { handleNavigation } from "../routes";
import { CmsNavigation } from "./CmsNavigation";

export function AppLayout({ section, children }: { section?: string; children: ReactNode }) {
  return <div className="app-layout" onClick={handleNavigation}>
    <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
    <CmsNavigation section={section} />
    <main id="main-content" tabIndex={-1}>{children}</main>
  </div>;
}
