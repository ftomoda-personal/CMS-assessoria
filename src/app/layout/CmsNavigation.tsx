import { Button, IconButton, Navbar, Toast } from "@ftomoda/spectra-design-system";
import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "../useTheme";
import { useAuth } from "../useAuth";
import { useLogout } from "../useLogout";

export function CmsNavigation({ section }: { section?: string }) {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const email = user?.email ?? "Conta autenticada";
  const initial = Array.from(user?.email?.trim() ?? "")[0]?.toLocaleUpperCase("pt-BR") ?? "?";
  const { isSigningOut, signOutError, handleSignOut, dismissSignOutError } = useLogout();

  return (
    <header>
      <Navbar
        aria-label="Navegação do CMS"
        showLanguage={false}
        showTheme={false}
        brand={
          <div className="cms-brand" role="img" aria-label="XPTO Assessoria Esportiva">
            <img
              alt=""
              src={theme === "dark" ? "/logo-xpto.svg" : "/logo-xpto_black.svg"}
            />
            <span className="cms-brand-name">
              <span>XPTO</span>
              <span className="cms-brand-description">ASSESSORIA ESPORTIVA</span>
            </span>
          </div>
        }
        actions={
          <div className="cms-nav-actions">
            <IconButton
              className="cms-theme-toggle"
              variant="tertiary"
              size="small"
              icon={theme === "light" ? Moon : Sun}
              aria-label={theme === "light" ? "Ativar modo escuro" : "Ativar modo claro"}
              onClick={toggleTheme}
            />
            <div className="cms-admin" title={email} aria-label={`Conta autenticada: ${email}`}>
              <span className="cms-avatar" aria-hidden="true">
                {initial}
              </span>
              <span className="cms-admin-email">{email}</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<LogOut size={16} aria-hidden="true" />}
              disabled={isSigningOut}
              aria-busy={isSigningOut}
              onClick={() => void handleSignOut()}
            >
              {isSigningOut ? "Saindo…" : "Sair"}
            </Button>
          </div>
        }
        items={[
          { label: "Ofertas", href: "/offers", current: section === "offers" },
          {
            label: "Parceiros",
            href: "/partners",
            current: section === "partners",
          },
          { label: "Usuários", href: "", disabled: true },
        ]}
      />
      {signOutError && <div className="cms-signout-feedback">
        <Toast
          variant="error"
          role="alert"
          title="Não foi possível sair"
          description="Tente novamente."
          closeLabel="Fechar aviso"
          onDismiss={dismissSignOutError}
        />
      </div>}
    </header>
  );
}
