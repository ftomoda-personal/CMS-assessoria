import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, Input } from "@ftomoda/spectra-design-system";
import { ArrowUpRight, Check, CircleCheck, LoaderCircle, MailOpen, X } from "lucide-react";
import { AuthSurface } from "./AuthSurface";
import { PasswordField } from "./PasswordField";
import { passwordRequirements } from "../passwordRequirements";

export type RecoveryView = "request" | "requested" | "password" | "success" | "invalid" | "expired" | "verifying" | "network" | "uncertain" | "cleanup";
export interface RecoveryScreenProps {
  view?: RecoveryView;
  busy?: boolean;
  failed?: boolean;
  message?: string;
  submitDisabled?: boolean;
  onBack(): void;
  onRequest?: (email: string) => void;
  onReset?: (password: string) => void;
}

/** Presentation only; trusted adapters own verification and mutation. */
export function RecoveryScreen({ view = "request", busy = false, failed = false, message, submitDisabled = false, onBack, onRequest, onReset }: RecoveryScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [attempted, setAttempted] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const confirmationInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId(), requirementsId = useId(), availabilityId = useId();
  const checks = passwordRequirements(password);
  const validPassword = checks.every(check => check.met);
  const mismatch = Boolean(confirmation) && confirmation !== password;
  const available = view === "request" ? Boolean(onRequest) : Boolean(onReset);
  const title = { request: "Esqueci minha senha", requested: "Verifique sua Caixa de Entrada", password: "Crie sua nova senha", success: "Senha criada com sucesso!", invalid: "Link de recuperação inválido", expired: "Link de recuperação expirado", verifying: "Validando recuperação", network: "Não foi possível verificar o link", uncertain: "Resultado não confirmado", cleanup: "Finalizar recuperação" }[view];

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [view]);
  function validateEmail() {
    const message = !email.trim() ? "Informe seu e-mail." : !emailInput.current?.validity.valid ? "Informe um e-mail válido." : undefined;
    setEmailError(message); return message;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submitDisabled) return;
    if (view === "request") {
      if (validateEmail()) { emailInput.current?.focus(); return; }
      onRequest?.(email.trim());
    } else if (view === "password") {
      setAttempted(true);
      if (!validPassword || !confirmation || mismatch) { (!validPassword ? passwordInput : confirmationInput).current?.focus(); return; }
      onReset?.(password);
    }
  }
  const back = <Button type="button" variant="tertiary" disabled={busy} onClick={onBack}>{view === "request" ? "Cancelar" : "Voltar"}</Button>;
  return <AuthSurface recovery>
    <section className={`login-card recovery-card recovery-card--${view}`} aria-labelledby={titleId}>
      <div className="recovery-content">
        {view === "requested" && <MailOpen className="recovery-state-icon" size={40} aria-hidden="true" />}
        {view === "success" && <CircleCheck className="recovery-state-icon recovery-state-icon--success" size={40} aria-hidden="true" />}
        <header className="login-intro"><h1 id={titleId} ref={heading} tabIndex={-1}>{title}</h1>
          {view === "request" && <p>Informe seu e-mail para solicitar instruções de recuperação de senha.</p>}
          {view === "requested" && <p role="status">Se houver uma conta para esse endereço, as instruções de recuperação serão enviadas.</p>}
          {view === "password" && <p>Escolha uma nova senha e confirme abaixo.</p>}
          {view === "invalid" && <p role="alert">Não foi possível validar este link. Solicite novas instruções de recuperação.</p>}
          {view === "expired" && <p role="alert">Este link não pode mais ser usado. Solicite novas instruções de recuperação.</p>}
          {view === "success" && <p role="status">Você já pode voltar ao login.</p>}
        </header>
        {(view === "request" || view === "password") && <form className="recovery-form" noValidate onSubmit={submit} aria-label={view === "request" ? "Solicitar recuperação" : "Criar nova senha"} aria-busy={busy}>
          {view === "request" ? <Input ref={emailInput} label="E-mail cadastrado" name="recovery-email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="seunome@empresa.com.br" value={email} readOnly={busy} state={emailError ? "error" : "default"} errorMessage={emailError} onBlur={validateEmail} onChange={event => { setEmail(event.target.value); setEmailError(undefined); }} /> : <>
            <PasswordField ref={passwordInput} label="Nova senha" name="new-password" autoComplete="new-password" placeholder="Digite a nova senha" value={password} readOnly={busy} state={attempted && !validPassword ? "error" : "default"} errorMessage="A senha deve atender a todos os requisitos." aria-describedby={requirementsId} onChange={event => setPassword(event.target.value)} />
            <ul id={requirementsId} className="password-requirements" aria-label="Requisitos da senha">{checks.map(check => <li key={check.key} data-met={check.met}>{check.met ? <Check size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}<span>{check.label}<span className="auth-sr-only">: {check.met ? "atendido" : "não atendido"}</span></span></li>)}</ul>
            <PasswordField ref={confirmationInput} label="Confirmação de senha" name="confirm-password" autoComplete="new-password" placeholder="Confirme a senha" value={confirmation} readOnly={busy} state={mismatch || (attempted && !confirmation) ? "error" : "default"} errorMessage={mismatch ? "Senhas não conferem." : "Confirme a nova senha."} onChange={event => setConfirmation(event.target.value)} />
          </>}
          {!available && <p id={availabilityId} className="recovery-unavailable" role="status">Em breve. A recuperação de senha ainda não está disponível. Nenhum e-mail será enviado e nenhuma senha será alterada.</p>}
          {message && <p className="login-error" role="alert">{message}</p>}
          {failed && <p className="login-error" role="alert">Não foi possível concluir a solicitação. Tente novamente mais tarde.</p>}
          <div className="recovery-actions"><Button type="submit" disabled={busy || submitDisabled || !available || (view === "password" && (!validPassword || !confirmation || mismatch))} aria-describedby={!available ? availabilityId : undefined} leadingIcon={busy ? <LoaderCircle className="login-loader" aria-hidden="true" /> : view === "request" ? <ArrowUpRight size={16} aria-hidden="true" /> : undefined}>{busy ? view === "request" ? "Solicitando…" : "Criando senha…" : view === "request" ? "Enviar" : "Criar senha"}</Button>{back}</div>
        </form>}
        {view === "requested" && <><div className="recovery-actions"><Button onClick={onBack} trailingIcon={<ArrowUpRight size={16} />}>Ir para o login</Button>{back}</div><p className="recovery-help">Confira também a caixa de spam. Nenhuma informação sobre a existência de uma conta é exibida.</p></>}
        {view === "success" && <div className="recovery-actions"><Button onClick={onBack}>Ir para o login</Button></div>}
        {!["request", "requested", "password", "success"].includes(view) && <><p role="status">{message ?? (view === "verifying" ? "Aguarde a validação do contexto de recuperação." : "O acesso ao CMS permanece bloqueado. Volte ao login para continuar.")}</p></>}
        {!["request", "requested", "password", "success", "verifying"].includes(view) && <div className="recovery-actions"><Button disabled={busy} onClick={onBack}>{view === "cleanup" ? "Tentar finalizar limpeza local" : "Voltar para o login"}</Button></div>}
      </div>
    </section>
  </AuthSurface>;
}
