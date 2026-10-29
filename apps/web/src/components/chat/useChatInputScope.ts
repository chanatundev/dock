import { useLayoutEffect } from "react";

const SCOPE = "[data-chat-input-scope]";
const ACTIVE = "[data-chat-input-active]";

// Portaled controls and body-focused typing belong to the most recently used pane.
export function useChatInputScope(root: HTMLElement | null) {
  useLayoutEffect(() => {
    if (root === null) return;
    root.setAttribute("data-chat-input-scope", "");
    const activate = () => {
      document.querySelector(ACTIVE)?.removeAttribute("data-chat-input-active");
      root.setAttribute("data-chat-input-active", "");
    };
    const onInteraction = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(SCOPE) === root) activate();
    };
    if (root.querySelector(SCOPE) === null) activate();
    root.addEventListener("pointerdown", onInteraction, true);
    root.addEventListener("focusin", onInteraction, true);
    return () => {
      root.removeEventListener("pointerdown", onInteraction, true);
      root.removeEventListener("focusin", onInteraction, true);
      const wasActive = root.hasAttribute("data-chat-input-active");
      root.removeAttribute("data-chat-input-active");
      root.removeAttribute("data-chat-input-scope");
      if (wasActive) root.parentElement?.closest(SCOPE)?.setAttribute("data-chat-input-active", "");
    };
  }, [root]);
  return (target: EventTarget | null) => {
    if (root === null) return false;
    const owner = target instanceof Element ? target.closest(SCOPE) : null;
    return (owner ?? document.querySelector(ACTIVE)) === root;
  };
}
