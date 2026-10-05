/** Session-only transport seam. Replace with Storage without changing the Dropzone. */
export function simulateLogoUpload(onProgress: (value: number) => void, onComplete: (failed: boolean) => void, fail = false) {
  let value = 0;
  const timer = window.setInterval(() => {
    value += 10;
    onProgress(value);
    if ((fail && value === 20) || value === 100) {
      window.clearInterval(timer);
      onComplete(fail);
    }
  }, 160);
  return () => window.clearInterval(timer);
}
export const logoAccept = '.png,.jpg,.svg';
export function validateLogo(file: File): string | undefined {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' };
  if (!extension || !types[extension] || (file.type && file.type !== types[extension])) return 'Formato incorreto. Favor usar JPG, PNG ou SVG.';
  if (file.size > 2 * 1024 * 1024) return 'O arquivo deve ter no máximo 2MB';
}
