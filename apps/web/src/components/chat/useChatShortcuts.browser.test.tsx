import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import type { ChatComposerHandle } from "./ChatComposer";
import { useChatShortcuts } from "./useChatShortcuts";
import { useChatInputScope } from "./useChatInputScope";
import { usePasteToFocusComposer } from "./usePasteToFocusComposer";

const shortcutContext = {
  terminalFocus: false,
  terminalOpen: false,
  previewFocus: false,
  previewOpen: false,
  isWeb: true,
  isDesktop: false,
  modelPickerOpen: false,
};

const focusOnMount = (element: HTMLElement | null) => element?.focus();

// Stands in for the right panel's launcher, which needs the whole app around it. Like the
// real one it takes focus, advertises its letters in `data-surface-launcher-keys`, and
// claims one from its own window capture listener unless the key was already handled.
function Launcher(props: { keys: string; received: string[] }) {
  useEffect(() => {
    const claim = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!props.keys.toLowerCase().split("").includes(event.key.toLowerCase())) return;
      event.preventDefault();
      props.received.push(event.key);
    };
    window.addEventListener("keydown", claim, true);
    return () => window.removeEventListener("keydown", claim, true);
  }, [props.keys, props.received]);
  return (
    <div
      ref={focusOnMount}
      tabIndex={0}
      aria-label="Open a surface"
      data-surface-launcher-keys={props.keys}
    />
  );
}

// The chat's shortcut listener registers when the chat mounts, so a launcher that opens
// later registers after it. Tests mount the chat first and add the launcher by rerendering.
function Chat(props: {
  composerKeys: string[];
  launcher?: { keys: string; received: string[] };
  acceptsEventTarget?: (target: EventTarget | null) => boolean;
  children?: ReactNode;
}) {
  useChatShortcuts({
    enabled: true,
    acceptsEventTarget: props.acceptsEventTarget,
    keybindings: [],
    scriptKeybindings: [],
    getShortcutContext: () => shortcutContext,
    threadFindActive: false,
    // Type-to-focus only calls insertTextAtEnd, so the stand-in composer implements just that.
    composerRef: {
      current: {
        insertTextAtEnd: (key: string) => {
          props.composerKeys.push(key);
          return true;
        },
      } as Partial<ChatComposerHandle> as ChatComposerHandle,
    },
    branchToolbarRef: { current: null },
    closeThreadFind: () => {},
    commands: {},
    fallback: () => undefined,
  });
  return (
    <>
      {props.launcher ? <Launcher {...props.launcher} /> : null}
      {props.children}
    </>
  );
}

// router: false because the chat shortcuts and the launcher stand-in never navigate.
const options = { router: false } as const;

function ScopedChat(props: { keys: string[]; label: string; children?: ReactNode }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const acceptsEventTarget = useChatInputScope(root);
  usePasteToFocusComposer(
    ThreadId.make(props.label),
    {
      current: {
        isModelPickerOpen: () => false,
        pasteTextAtEnd: (text: string) => {
          props.keys.push(text);
          return true;
        },
      } as Partial<ChatComposerHandle> as ChatComposerHandle,
    },
    acceptsEventTarget,
  );
  return (
    <div ref={setRoot}>
      <Chat composerKeys={props.keys} acceptsEventTarget={acceptsEventTarget}>
        <section tabIndex={0} aria-label={props.label}>
          {props.label}
        </section>
        {props.children}
      </Chat>
    </div>
  );
}

it("remembers the pane owning a body-focused paste and restores the parent on side-pane close", async () => {
  const parent: string[] = [];
  const side: string[] = [];
  await using screen = await render(
    <StrictMode>
      <ScopedChat keys={parent} label="Parent">
        <ScopedChat keys={side} label="Side" />
      </ScopedChat>
    </StrictMode>,
    options,
  );
  await screen.getByRole("region", { name: "Side", exact: true }).click();
  (document.activeElement as HTMLElement).blur();
  const clipboard = new DataTransfer();
  clipboard.setData("text/plain", "Side question");
  document.body.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
  );
  expect(side).toEqual(["Side question"]);
  expect(parent).toEqual([]);
  await screen.rerender(
    <StrictMode>
      <ScopedChat keys={parent} label="Parent" />
    </StrictMode>,
  );
  await userEvent.keyboard("p");
  expect(parent).toEqual(["p"]);
  expect(side).toEqual(["Side question"]);
});

it("sends typing to the focused chat when a side chat is mounted beside its parent", async () => {
  const parent: string[] = [];
  const side: string[] = [];
  const matches = (id: string) => (target: EventTarget | null) =>
    target instanceof Element &&
    target.closest("[data-test-chat]")?.getAttribute("data-test-chat") === id;
  await using screen = await render(
    <Chat composerKeys={parent} acceptsEventTarget={matches("parent")}>
      <div data-test-chat="parent">
        <section tabIndex={0} aria-label="Parent timeline">
          Parent
        </section>
        <Chat composerKeys={side} acceptsEventTarget={matches("side")}>
          <div data-test-chat="side">
            <section tabIndex={0} aria-label="Side timeline">
              Side
            </section>
          </div>
        </Chat>
      </div>
    </Chat>,
    options,
  );
  await screen.getByRole("region", { name: "Side timeline" }).click();
  await userEvent.keyboard("a");
  expect(side).toEqual(["a"]);
  expect(parent).toEqual([]);
  await screen.getByRole("region", { name: "Parent timeline" }).click();
  await userEvent.keyboard("b");
  expect(parent).toEqual(["b"]);
  expect(side).toEqual(["a"]);
});

it("leaves the launcher's letters to the launcher, in either case", async () => {
  const composerKeys: string[] = [];
  const received: string[] = [];
  await using screen = await render(<Chat composerKeys={composerKeys} />, options);
  await screen.rerender(<Chat composerKeys={composerKeys} launcher={{ keys: "BT", received }} />);

  await userEvent.keyboard("tT");

  expect(received).toEqual(["t", "T"]);
  expect(composerKeys).toEqual([]);
});

it("still types other letters into the composer while the launcher is open", async () => {
  const composerKeys: string[] = [];
  const received: string[] = [];
  await using screen = await render(<Chat composerKeys={composerKeys} />, options);
  await screen.rerender(<Chat composerKeys={composerKeys} launcher={{ keys: "BT", received }} />);

  await userEvent.keyboard("a");

  expect(composerKeys).toEqual(["a"]);
  expect(received).toEqual([]);
});
