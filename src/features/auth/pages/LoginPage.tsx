import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, Input } from "@ftomoda/spectra-design-system";
import { LoaderCircle, LogIn } from "lucide-react";
import { supabase } from "../../../lib/supabase/client";
import { AuthSurface } from "../components/AuthSurface";
import { RecoveryRequest } from "../recovery/RecoveryRequest";
import { recoveryIsolation } from "../recovery/browserIsolation";
import "../login.css";

const rejection = "Não foi possível entrar. Verifique suas credenciais e tente novamente.";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [authError, setAuthError] = useState(false);
  const [isolationError, setIsolationError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const submitting = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [recovery, setRecovery] = useState(false);
  const recoveryTrigger = useRef<HTMLButtonElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setAuthError(false);
    setIsolationError(false);
    const nextErrors: typeof errors = {};
    if (!email.trim()) nextErrors.email = "Informe seu e-mail.";
    else if (!emailInput.current?.validity.valid) nextErrors.email = "Informe um e-mail válido.";
    if (!password) nextErrors.password = "Informe sua senha.";
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) {
      (nextErrors.email ? emailInput : passwordInput).current?.focus();
      return;
    }

    submitting.current = true;
    setProcessing(true);
    const attempt = recoveryIsolation.loginAttempt();
    try {
      if (!attempt) { setIsolationError(true); return; }
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data.session) setAuthError(true);
      else if (!recoveryIsolation.admitPasswordLogin(data.session, attempt)) setIsolationError(true);
      // AuthProvider observes the successful session; the route boundary redirects.
    } catch {
      setAuthError(true);
    } finally {
      submitting.current = false;
      setProcessing(false);
    }
  }

  if (recovery) return <RecoveryRequest onBack={() => { setRecovery(false); requestAnimationFrame(() => recoveryTrigger.current?.focus()); }} />;

  return <AuthSurface>
    <form className="login-card" onSubmit={submit} noValidate aria-labelledby="login-title" aria-busy={processing}>
      <header className="login-brand">
        <div className="login-logo-frame"><img src="/logo-xpto.svg" alt="XPTO Assessoria Esportiva" width="82" height="96" /></div>
        <div><h1>PARCERIAS</h1><p>Aqui estão os benefícios para nossos alunos</p></div>
      </header>
      <div className="login-content">
        <div className="login-intro"><h2 id="login-title">Acesse sua conta</h2><p>Entre com suas credenciais para continuar</p></div>
        <div className="login-inputs">
          <Input ref={emailInput} size="md" label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="seunome@empresa.com.br" value={email} readOnly={processing}
            state={authError || errors.email ? "error" : "default"} supportingText={errors.email} showSupportingText={!authError && Boolean(errors.email)}
            aria-invalid={authError || Boolean(errors.email)} aria-describedby={authError ? "login-error" : undefined}
            onChange={event => { setEmail(event.target.value); setAuthError(false); setErrors(current => ({ ...current, email: undefined })); }} />
          <Input ref={passwordInput} size="md" label="Senha" name="password" type="password" autoComplete="current-password" placeholder="Digite sua senha" value={password} readOnly={processing}
            state={authError || errors.password ? "error" : "default"} supportingText={errors.password} showSupportingText={!authError && Boolean(errors.password)}
            aria-invalid={authError || Boolean(errors.password)} aria-describedby={authError ? "login-error" : undefined}
            onChange={event => { setPassword(event.target.value); setAuthError(false); setErrors(current => ({ ...current, password: undefined })); }} />
        </div>
        {authError && <p className="login-error" id="login-error" role="alert">{rejection}</p>}
        {isolationError && <p className="login-error" role="alert">O acesso local permanece bloqueado pelo isolamento de recuperação. Resolva o contexto local e entre novamente. Nenhum envio será repetido automaticamente.</p>}
        <div className="login-actions"><Button type="submit" variant="primary" size="md" disabled={processing} leadingIcon={processing ? <LoaderCircle className="login-loader" aria-hidden="true" /> : <LogIn aria-hidden="true" />}>{processing ? "Entrando…" : "Entrar"}</Button><Button ref={recoveryTrigger} type="button" variant="tertiary" disabled={processing} onClick={() => setRecovery(true)}>Esqueci minha senha</Button></div>
      </div>
    </form>
  </AuthSurface>;
}
