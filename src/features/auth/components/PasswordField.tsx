import { useState } from "react";
import type { ComponentProps } from "react";
import { IconButton, Input } from "@ftomoda/spectra-design-system";
import { Eye, EyeOff } from "lucide-react";

export function PasswordField(props: Omit<ComponentProps<typeof Input>, "type" | "trailingIcon">) {
  const [visible, setVisible] = useState(false);
  // Input's icon slots are aria-hidden; keep the interactive toggle outside them.
  return <div className="auth-password-field"><Input {...props} type={visible ? "text" : "password"} /><IconButton icon={visible ? EyeOff : Eye} variant="tertiary" size="small" aria-label={`${visible ? "Ocultar" : "Mostrar"} ${props.label?.toLocaleLowerCase("pt-BR")}`} aria-pressed={visible} disabled={props.disabled || props.readOnly} onClick={() => setVisible(current => !current)} /></div>;
}
