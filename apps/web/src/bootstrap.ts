import { showBootError } from "./lib/bootError";
import dockIconUrl from "../../desktop/resources/branding/dock-renderer.png";

const desktopBranding = window.desktopBridge?.getAppBranding?.();
if (desktopBranding?.baseName === "dock") {
  document.title = desktopBranding.displayName;
  const bootLogo = document.getElementById("boot-shell-logo");
  if (bootLogo instanceof HTMLImageElement) {
    bootLogo.src = dockIconUrl;
    bootLogo.alt = "dock";
  }
  document.getElementById("boot-shell-card")?.setAttribute("aria-label", "dock splash screen");
  document
    .querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]')
    .forEach((link) => link.setAttribute("href", dockIconUrl));
}

// Bundled dev can move UI code into shared chunks. Load it only after this
// entry runs the React refresh preamble, and catch failures before React mounts.
void import("./main").then(({ startup }) => startup).catch(showBootError);
