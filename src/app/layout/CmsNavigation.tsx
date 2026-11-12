import { Button, IconButton, Navbar, Toast } from "@ftomoda/spectra-design-system";
import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "../useTheme";
import { useAuth } from "../useAuth";
import { useLogout } from "../useLogout";
import { useNavigationOverlay } from "./useNavigationOverlay";
import "./navigation.css";

export function CmsNavigation({ section }: { section?: string }) {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const email = user?.email ?? "Conta autenticada";
  const initial = Array.from(user?.email?.trim() ?? "")[0]?.toLocaleUpperCase("pt-BR") ?? "?";
  const { isSigningOut, signOutError, handleSignOut, dismissSignOutError } = useLogout();
  const { headerRef, open, close } = useNavigationOverlay();
  const account = <div className="cms-admin" title={email} aria-label={`Conta autenticada: ${email}`}>
    <span className="cms-avatar" aria-hidden="true">{initial}</span>
    <span className="cms-admin-email">{email}</span>
  </div>;
  const signOutFeedback = signOutError && <Toast
    variant="error" role="alert" title="Não foi possível sair" description="Tente novamente."
    closeLabel="Fechar aviso" onDismiss={dismissSignOutError}
  />;

  return (
    <header ref={headerRef} className={`cms-navigation${open ? " cms-navigation--overlay" : ""}`}>
      {open && <div className="cms-navigation-backdrop" aria-hidden="true" onClick={event => {
        event.preventDefault();
        event.stopPropagation();
        close();
      }} />}
      <Navbar
        aria-label="Navegação do CMS"
        onClickCapture={event => {
          if (event.target instanceof Element && event.target.closest('a[aria-disabled="true"]')) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        showLanguage={false}
        showTheme={false}
        brand={
          <><div className="cms-overlay-account">{account}</div><div className="cms-brand" role="img" aria-label="XPTO Assessoria Esportiva">
            <img
              alt=""
              src={theme === "dark" ? "/logo-xpto.svg" : "/logo-xpto_black.svg"}
            />
            <span className="cms-brand-name">
              <span>XPTO</span>
              <span className="cms-brand-description">ASSESSORIA ESPORTIVA</span>
            </span>
          </div></>
        }
        actions={
          <div className="cms-nav-actions">
            <IconButton
              hidden={open}
              className="cms-theme-toggle"
              variant="tertiary"
              size="small"
              icon={theme === "light" ? Moon : Sun}
              aria-label={theme === "light" ? "Ativar modo escuro" : "Ativar modo claro"}
              onClick={toggleTheme}
            />
            <div className="cms-overlay-theme"><Button variant="tertiary" size="sm"
              aria-label={theme === "light" ? "Ativar modo escuro" : "Ativar modo claro"}
              trailingIcon={theme === "light" ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
              onClick={toggleTheme}>{theme === "light" ? "Light" : "Dark"}</Button></div>
            <div className="cms-desktop-account">{account}</div>
            <Button
              className="cms-signout"
              variant="secondary"
              size="sm"
              leadingIcon={<LogOut size={16} aria-hidden="true" />}
              disabled={isSigningOut}
              aria-busy={isSigningOut}
              onClick={() => void handleSignOut()}
            >
              {isSigningOut ? "Saindo…" : "Sair"}
            </Button>
            <div className="cms-signout-feedback cms-signout-feedback--compact">{signOutFeedback}</div>
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
      {signOutError && <div className="cms-signout-feedback cms-signout-feedback--outside">{signOutFeedback}</div>}
    </header>
  );
}
