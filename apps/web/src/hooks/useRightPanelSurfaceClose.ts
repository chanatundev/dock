import {
  AuthPreviewOperateScope,
  AuthTerminalOperateScope,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { terminalEnvironment } from "../state/terminal";
import { agentControlledBrowserCloseConfirmation } from "../components/ChatView.logic";
import { closePreviewSession } from "../components/preview/closePreviewSession";
import { useThreadTerminalActions } from "../components/terminal/useThreadTerminalActions";
import { confirmTerminalClose, terminalCloseLabels } from "../lib/terminalCloseConfirm";
import { readLocalApi } from "../localApi";
import { readThreadPreviewState, setActivePreviewTab } from "../previewStateStore";
import {
  resolveRightPanelSurfaceTarget,
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "../rightPanelStore";
import { previewEnvironment } from "../state/preview";
import { readEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { useStableCallback } from "./useStableCallback";

/**
 * Closes right panel surfaces for a thread. A surface's live resources go with
 * it: a browser's preview session and a terminal tab's sessions. Closing a
 * browser an agent is driving, or a terminal tab, asks first.
 */
export function useRightPanelSurfaceClose(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly terminalLabelsById: ReadonlyMap<string, string>;
}) {
  const { threadRef, terminalLabelsById } = input;
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  const terminalActions = useThreadTerminalActions(threadRef);
  const storeCloseTerminal = useTerminalUiStateStore((state) => state.closeTerminal);
  const surfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces,
  );

  const releaseSurfaceResources = (ref: ScopedThreadRef, surface: RightPanelSurface) => {
    // Without preview access only the local surface goes away. The
    // server record is in-memory bookkeeping, not a live view, and stays
    // listed until a client with the scope closes it or the server restarts.
    if (
      readEnvironmentScope(ref.environmentId, AuthPreviewOperateScope) &&
      surface.kind === "preview" &&
      surface.resourceId
    ) {
      void closePreviewSession({
        closePreview,
        snapshot: readThreadPreviewState(ref).sessions[surface.resourceId] ?? null,
        tabId: surface.resourceId,
        threadRef: ref,
      });
    }
    if (
      surface.kind === "terminal" &&
      readEnvironmentScope(ref.environmentId, AuthTerminalOperateScope)
    ) {
      for (const terminalId of surface.terminalIds) {
        storeCloseTerminal(ref, terminalId);
        terminalActions.closeTerminalSession(terminalId, ref);
      }
    }
  };
  const closeAfterAgentBrowserConfirmation = (
    toClose: readonly RightPanelSurface[],
    closeSurfaces: () => void,
  ) => {
    if (!threadRef) return;
    const message = toClose
      .flatMap((surface) => {
        const target = resolveRightPanelSurfaceTarget(
          threadRef,
          surface,
          useRightPanelStore.getState().byThreadKey,
        );
        const warning =
          target.surface === null
            ? null
            : agentControlledBrowserCloseConfirmation(
                [target.surface],
                readThreadPreviewState(target.threadRef).desktopByTabId,
              );
        return warning ? [warning] : [];
      })
      .join("\n\n");
    if (!message) {
      closeSurfaces();
      return;
    }
    const localApi = readLocalApi();
    if (!localApi) return;
    void localApi.dialogs.confirm(message, { variant: "destructive" }).then(
      (confirmed) => {
        if (confirmed) closeSurfaces();
      },
      () => undefined,
    );
  };
  // The active surface closes last so the panel does not flash through it.
  const finishClose = (toClose: readonly RightPanelSurface[]) => {
    if (!threadRef) return;
    const store = useRightPanelStore.getState();
    const activeId = selectThreadRightPanelState(store.byThreadKey, threadRef).activeSurfaceId;
    const ordered = toClose.toSorted(
      (left, right) => Number(left.id === activeId) - Number(right.id === activeId),
    );
    for (const surface of ordered) {
      const target = resolveRightPanelSurfaceTarget(threadRef, surface, store.byThreadKey);
      if (target.surface !== null) {
        releaseSurfaceResources(target.threadRef, target.surface);
        if (surface.kind === "sidechat-tool")
          store.closeSurface(target.threadRef, target.surface.id);
      }
      store.closeSurface(threadRef, surface.id);
    }
    const nextActiveSurface = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      threadRef,
    );
    if (nextActiveSurface?.kind === "preview" && nextActiveSurface.resourceId) {
      setActivePreviewTab(threadRef, nextActiveSurface.resourceId);
    }
  };
  const closeSurfaces = (toClose: readonly RightPanelSurface[]) => {
    if (!threadRef) return;
    closeAfterAgentBrowserConfirmation(toClose, () => finishClose(toClose));
  };

  const closeSurface = useStableCallback((surface: RightPanelSurface) => {
    if (!threadRef) return;
    const target = resolveRightPanelSurfaceTarget(
      threadRef,
      surface,
      useRightPanelStore.getState().byThreadKey,
    );
    const resource = target.surface;
    if (resource?.kind === "preview") {
      closeSurfaces([surface]);
      return;
    }
    if (
      resource?.kind !== "terminal" ||
      !readEnvironmentScope(target.threadRef.environmentId, AuthTerminalOperateScope)
    ) {
      finishClose([surface]);
      return;
    }
    const summaries = Option.getOrNull(
      AsyncResult.value(
        appAtomRegistry.get(
          terminalEnvironment.metadata({
            environmentId: target.threadRef.environmentId,
            input: null,
          }),
        ),
      ),
    );
    const labels = terminalCloseLabels({
      owner: threadRef,
      target: target.threadRef,
      activeTerminalId: resource.activeTerminalId,
      terminalIds: resource.terminalIds,
      ownerLabels: terminalLabelsById,
      metadata:
        summaries === null ? null : { environmentId: target.threadRef.environmentId, summaries },
    });
    void confirmTerminalClose(labels).then((confirmed) => {
      if (confirmed) finishClose([surface]);
    });
  });
  const closeOtherSurfaces = useStableCallback((surface: RightPanelSurface) =>
    closeSurfaces(surfaces.filter((entry) => entry.id !== surface.id)),
  );
  const closeSurfacesToRight = useStableCallback((surface: RightPanelSurface) => {
    const surfaceIndex = surfaces.findIndex((entry) => entry.id === surface.id);
    if (surfaceIndex < 0) return;
    closeSurfaces(surfaces.slice(surfaceIndex + 1));
  });
  const closeAllSurfaces = useStableCallback(() => closeSurfaces(surfaces));

  return { closeSurface, closeOtherSurfaces, closeSurfacesToRight, closeAllSurfaces };
}
