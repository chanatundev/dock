import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect } from "react";
import {
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";

export function useSidechatToolHost(
  hostRef: ScopedThreadRef | undefined,
  childRef: ScopedThreadRef,
) {
  const hostKey = hostRef ? scopedThreadKey(hostRef) : null;
  const childKey = scopedThreadKey(childRef);
  useEffect(() => {
    if (!hostRef || hostKey === childKey) return;
    // Existing child panels do not steal focus when the conversation is reopened.
    return useRightPanelStore.subscribe((next, previous) => {
      if (
        next.userActionRevisionByThreadKey[childKey] ===
        previous.userActionRevisionByThreadKey[childKey]
      )
        return;
      if (!selectThreadRightPanelState(next.byThreadKey, childRef).isOpen) return;
      const surface = selectActiveRightPanelSurface(next.byThreadKey, childRef);
      if (surface && surface.kind !== "sidechat" && surface.kind !== "sidechat-tool")
        next.openSidechatTool(hostRef, childRef, surface);
    });
  }, [hostKey, childKey, hostRef, childRef]);
}
