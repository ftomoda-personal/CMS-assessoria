import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@ftomoda/spectra-design-system/tokens.css";
import "./index.css";
import App from "./App.tsx";

if (window.location.pathname === "/") window.history.replaceState(null, "", "/offers");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
