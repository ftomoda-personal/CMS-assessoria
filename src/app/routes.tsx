import { useSyncExternalStore } from "react";
import type { MouseEvent } from "react";

type Route = { pattern: RegExp; section: "offers" | "partners"; title: string; description?: string; page?: "offer-list" | "offer-create" | "offer-edit" | "partner-list" | "partner-create" | "partner-edit"; offerId?: string; partnerId?: string };
const routes: readonly Route[] = [
  { pattern: /^\/offers\/?$/, section: "offers", page: "offer-list", title: "OFERTAS", description: "Gerencie as ofertas dos parceiros" },
  { pattern: /^\/offers\/new\/?$/, section: "offers", page: "offer-create", title: "NOVA OFERTA" },
  { pattern: /^\/offers\/([^/]+)\/edit\/?$/, section: "offers", page: "offer-edit", title: "EDITAR OFERTA", description: "Modifique e exclua as ofertas" },
  { pattern: /^\/partners\/?$/, section: "partners", page: "partner-list", title: "PARCEIROS", description: "Gerencie os parceiros e suas ofertas" },
  { pattern: /^\/partners\/new\/?$/, section: "partners", page: "partner-create", title: "ADICIONAR PARCEIRO" },
  { pattern: /^\/partners\/([^/]+)\/edit\/?$/, section: "partners", page: "partner-edit", title: "EDITAR PARCEIRO" },
];

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

export function useRoute() {
  const pathname = useSyncExternalStore(subscribe, () => window.location.pathname);
  const route = routes.find(route => route.pattern.test(pathname));
  if (route?.page !== "offer-edit" && route?.page !== "partner-edit") return route;
  const idKey = route.page === "offer-edit" ? "offerId" : "partnerId";
  try {
    return { ...route, [idKey]: decodeURIComponent(route.pattern.exec(pathname)![1]) };
  } catch {
    return { ...route, [idKey]: "" };
  }
}

export function navigate(url: string) {
  window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Preserve normal anchors, new tabs, downloads and external navigation. */
export function handleNavigation(event: MouseEvent<HTMLElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target instanceof Element ? event.target.closest("a") : null;
  if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
  const url = new URL(anchor.href);
  if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.hash)) return;
  event.preventDefault();
  navigate(url.pathname + url.search + url.hash);
}
