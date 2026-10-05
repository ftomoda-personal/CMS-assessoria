import { IconButton, Navbar } from "@ftomoda/spectra-design-system";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../useTheme";

export function CmsNavigation({ section }: { section?: string }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <header>
      <Navbar
        aria-label="Navegação do CMS"
        showLanguage={false}
        showTheme={false}
        brand={
          <div className="cms-brand">
            <img
              src={theme === "dark" ? "/logo-xpto.svg" : "/logo-xpto_black.svg"}
            />
            <span>XPTO ASSESSORIA ESPORTIVA</span>
          </div>
        }
        actions={
          <div className="cms-nav-actions">
            <IconButton
              variant="tertiary"
              size="small"
              icon={theme === "light" ? Moon : Sun}
              aria-label={theme === "light" ? "Ativar modo escuro" : "Ativar modo claro"}
              onClick={toggleTheme}
            />
            <div className="cms-admin">
              <span>Admin</span>
              <span className="cms-avatar" aria-hidden="true">
                A
              </span>
            </div>
          </div>
        }
        items={[
          { label: "Ofertas", href: "/offers", current: section === "offers" },
          {
            label: "Parceiros",
            href: "/partners",
            current: section === "partners",
          },
        ]}
      />
    </header>
  );
}
