import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useComposerDraftStore } from "../composerDraftStore";
import { parseRouteToTabRef } from "../dockTabs.logic";
import { planDockSpaceRouteReveal, type DockSpaceRouteRevealState } from "../dockSpaces.logic";
import { useDockSpacesStore } from "../dockSpacesStore";
import { useQuietThreadShells } from "../state/entities";
import { useDockSpaceEnvironments } from "../state/spaces";

export function DockSpaceRouteCoordinator() {
  const location = useLocation();
  const route = parseRouteToTabRef(location);
  const selection = useDockSpacesStore((store) => store.selection);
  const setSelection = useDockSpacesStore((store) => store.setSelection);
  const { environments } = useDockSpaceEnvironments();
  const threads = useQuietThreadShells();
  const draft = useComposerDraftStore((store) =>
    route?.kind === "draft" && route.draftId ? store.getDraftSession(route.draftId) : null,
  );
  const thread =
    route?.kind === "thread"
      ? threads.find(
          (item) => item.environmentId === route.environmentId && item.id === route.threadId,
        )
      : null;
  const project = thread
    ? { environmentId: thread.environmentId, projectId: thread.projectId }
    : draft
      ? { environmentId: draft.environmentId, projectId: draft.projectId }
      : null;
  const isThreadView = route?.kind === "thread" || route?.kind === "draft";
  const reveal = useRef<DockSpaceRouteRevealState | null>(null);
  useEffect(() => {
    const next = planDockSpaceRouteReveal({
      previous: reveal.current,
      pathname: location.pathname,
      selection,
      isThreadView,
      project,
      environments,
    });
    reveal.current = next.state;
    if (next.selection !== null) setSelection(next.selection);
  }, [location.pathname, selection, isThreadView, project, environments, setSelection]);
  return null;
}
