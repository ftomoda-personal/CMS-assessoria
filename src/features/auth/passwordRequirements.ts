/** Presentation validation only; this does not configure Supabase Auth policy. */
export function passwordRequirements(password: string) {
  return [
    { key: "length", label: "Pelo menos 8 caracteres", met: password.length >= 8 },
    { key: "uppercase", label: "Pelo menos 1 maiúscula", met: /[A-Z]/.test(password) },
    { key: "lowercase", label: "Pelo menos 1 minúscula", met: /[a-z]/.test(password) },
    { key: "number", label: "Pelo menos 1 número", met: /[0-9]/.test(password) },
    { key: "special", label: "Pelo menos 1 caractere especial", met: /[^\p{L}\p{N}\s]/u.test(password) },
  ];
}
