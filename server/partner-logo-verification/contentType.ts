/** Server-only media type parser. Case-insensitive type and parameter names,
 * token/quoted-string values; no combined headers, duplicates or empty parameters.
 * JSON decoding remains UTF-8; an explicit incompatible charset is rejected.
 */
export function isVerificationJsonContentType(value: string | null): boolean {
  if (typeof value !== "string" || Array.from(value).some(c => { const code = c.charCodeAt(0); return code < 32 && code !== 9 || code === 127; })) return false;
  const type = /^\s*application\/json(?=\s|;|$)/i.exec(value);
  if (!type) return false;
  let rest = value.slice(type[0].length); const names = new Set<string>();
  const parameter = /^\s*;\s*([!#$%&'*+.^_`|~0-9a-z-]+)\s*=\s*([!#$%&'*+.^_`|~0-9a-z-]+|"(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\[\x20-\x7e])*")/i;
  while (rest.trim()) {
    const match = parameter.exec(rest); if (!match) return false;
    const name = match[1].toLowerCase(); if (names.has(name)) return false; names.add(name);
    const raw = match[2]; const decoded = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\([\x20-\x7e])/g, "$1") : raw;
    if (name === "charset" && decoded.toLowerCase() !== "utf-8") return false;
    rest = rest.slice(match[0].length);
  }
  return true;
}
