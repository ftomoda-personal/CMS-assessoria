import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { ThemeContext } from "./useTheme";
import type { Theme } from "./useTheme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  return <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme(current => current === "light" ? "dark" : "light") }}>{children}</ThemeContext.Provider>;
}

