import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Local Spectra 0.1.1 adapter. Its aria-expanded and container CSS remain authoritative. */
export function useNavigationOverlay() {
  const headerRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const restoreFrame = useRef<number | undefined>(undefined);
  const close = useCallback(() => {
    headerRef.current?.querySelector<HTMLButtonElement>('.spectra-navbar__mobile-header button[aria-expanded="true"]')?.click();
  }, []);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const navbar = header?.querySelector<HTMLElement>(".spectra-navbar");
    const mobile = navbar?.querySelector<HTMLElement>(".spectra-navbar__mobile");
    const trigger = mobile?.querySelector<HTMLButtonElement>("button[aria-expanded]");
    if (!header || !navbar || !mobile || !trigger) return;
    function sync() {
      const expanded = trigger!.getAttribute("aria-expanded") === "true";
      // Observe actual Spectra container-query output, not a second JS breakpoint.
      const compact = getComputedStyle(mobile!).display !== "none";
      if (!compact && expanded) trigger!.click();
      setOpen(compact && expanded);
    }
    const mutations = new MutationObserver(sync);
    mutations.observe(trigger, { attributes: true, attributeFilter: ["aria-expanded"] });
    const resize = new ResizeObserver(sync);
    resize.observe(navbar);
    sync();
    return () => { mutations.disconnect(); resize.disconnect(); };
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    if (restoreFrame.current !== undefined) cancelAnimationFrame(restoreFrame.current);
    const header = headerRef.current;
    const mobile = header?.querySelector<HTMLElement>(".spectra-navbar__mobile");
    const trigger = mobile?.querySelector<HTMLButtonElement>("button[aria-expanded]");
    if (!header || !mobile || !trigger) return;
    const attributes = ["role", "aria-modal", "aria-label"].map(name => [name, mobile.getAttribute(name)] as const);
    mobile.setAttribute("role", "dialog");
    mobile.setAttribute("aria-modal", "true");
    mobile.setAttribute("aria-label", "Navegação do CMS");

    // Make all background branches inert, preserving any pre-existing inert state.
    const background: { element: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement = header;
    while (branch.parentElement && branch.parentElement !== document.documentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
    const x = window.scrollX;
    const y = window.scrollY;
    const body = document.body;
    const properties = ["position", "top", "left", "width", "overflow"];
    const styles = properties.map(name => [name, body.style.getPropertyValue(name), body.style.getPropertyPriority(name)] as const);
    body.style.position = "fixed";
    body.style.top = `${-y}px`;
    body.style.left = `${-x}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    function focusable() {
      return [...mobile!.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length > 0 && !element.closest('[hidden], [inert], [aria-disabled="true"]'));
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === "Tab") {
        const elements = focusable();
        const index = elements.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (index <= 0 ? elements.length - 1 : index - 1) : (index + 1) % elements.length;
        event.preventDefault();
        (elements[next] ?? trigger!).focus();
      }
    }
    function containFocus(event: FocusEvent) {
      if (event.target instanceof Node && !mobile!.contains(event.target)) trigger!.focus();
    }
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", containFocus, true);
    trigger.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", containFocus, true);
      for (const { element, inert } of background) element.inert = inert;
      for (const [name, value] of attributes) {
        if (value === null) mobile.removeAttribute(name);
        else mobile.setAttribute(name, value);
      }
      for (const [name, value, priority] of styles) {
        if (value) body.style.setProperty(name, value, priority);
        else body.style.removeProperty(name);
      }
      window.scrollTo(x, y);
      restoreFrame.current = requestAnimationFrame(() => {
        if (!header.isConnected) return;
        const destination = trigger.getClientRects().length > 0 ? trigger
          : header.querySelector<HTMLElement>('.spectra-navbar__desktop a[aria-current="page"]');
        destination?.focus({ preventScroll: true });
      });
    };
  }, [open, close]);

  useLayoutEffect(() => () => {
    if (restoreFrame.current !== undefined) cancelAnimationFrame(restoreFrame.current);
  }, []);

  return { headerRef, open, close };
}
