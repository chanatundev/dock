import type { EditorId, EnvironmentId, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useEffect, useEffectEvent } from "react";

import { usePreferredEditor } from "../../editorPreferences";
import { isOpenFavoriteEditorShortcut } from "../../keybindings";
import { useRemoteOpenState } from "../../remoteOpen";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";

export function useOpenFavoriteEditorShortcut({
  enabled,
  environmentId,
  keybindings,
  availableEditors,
  openInCwd,
  acceptsEventTarget,
}: {
  enabled: boolean;
  environmentId: EnvironmentId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
  acceptsEventTarget?: (target: EventTarget | null) => boolean;
}) {
  const ownsTarget = useEffectEvent(
    (target: EventTarget | null) => acceptsEventTarget?.(target) !== false,
  );
  const openInEditorMutation = useAtomCommand(shellEnvironment.openInEditor, "open in editor");
  const [preferredEditor] = usePreferredEditor(availableEditors);
  const remote = useRemoteOpenState(environmentId);

  useEffect(() => {
    if (!enabled || remote.mode !== "local-exec") return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!ownsTarget(event.target)) return;
      if (event.defaultPrevented || !isOpenFavoriteEditorShortcut(event, keybindings)) return;
      if (!openInCwd || !preferredEditor) return;

      event.preventDefault();
      void openInEditorMutation({
        environmentId,
        input: {
          cwd: openInCwd,
          editor: preferredEditor,
        },
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    enabled,
    environmentId,
    keybindings,
    openInCwd,
    openInEditorMutation,
    preferredEditor,
    remote.mode,
  ]);
}
