import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const serverRoots = ["api", "server"].map(directory => resolve(root, directory));

/** Reject server modules even through a symlink or a ?raw/?url import. */
export function assertBrowserModule(id: string): void {
  const clean = id.split(/[?#]/)[0];
  if (!isAbsolute(clean)) return;
  let canonical = clean;
  try { canonical = realpathSync(clean); } catch { /* Vite reports missing files. */ }
  if (serverRoots.some(directory => {
    const path = relative(directory, canonical);
    return path === "" || (path !== ".." && !path.startsWith("../") && !isAbsolute(path));
  })) throw new Error("Server-only modules cannot enter the browser bundle");
}

export default defineConfig({
  plugins: [
    {
      name: "cms-browser-boundary",
      enforce: "pre",
      resolveId: { async handler(source, importer, options) {
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (resolved) assertBrowserModule(resolved.id);
        return resolved;
      } },
      load(id) { assertBrowserModule(id); return null; },
    },
    react(),
  ],
  resolve: { dedupe: ["react", "react-dom"] },
});
