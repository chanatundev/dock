import type { ScopedThreadRef } from "@t3tools/contracts";
import { useContext } from "react";
import { ThreadRouteScope } from "../threadRouteScope";
import { useParams } from "@tanstack/react-router";

import {
  resolveThreadRouteRef,
  resolveThreadRouteTarget,
  type ThreadRouteTarget,
} from "../threadRoutes";

// The router re-runs selectors on every store update (preloads, location state,
// same-route navigations) and compares with ===. Selecting the string params keeps
// those updates from reaching consumers; the target is then built once per id change.
function useThreadRouteIds() {
  const environmentId = useParams({ strict: false, select: (params) => params.environmentId });
  const threadId = useParams({ strict: false, select: (params) => params.threadId });
  const embedded = useContext(ThreadRouteScope);
  return embedded ?? { environmentId, threadId };
}

export function useThreadRouteTarget(): ThreadRouteTarget | null {
  const { environmentId, threadId } = useThreadRouteIds();
  const draftId = useParams({ strict: false, select: (params) => params.draftId });
  const embedded = useContext(ThreadRouteScope);
  return resolveThreadRouteTarget({
    environmentId,
    threadId,
    draftId: embedded ? undefined : draftId,
  });
}

export function useThreadRouteRef(): ScopedThreadRef | null {
  return resolveThreadRouteRef(useThreadRouteIds());
}
