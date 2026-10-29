import { Link } from "@tanstack/react-router";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import {
  type RightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../../rightPanelStore";
import { useProject, useQuietThreadShell } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { SIDECHAT_TOOL_LABELS } from "../../sidechatTools.logic";
import { ThreadRouteScope } from "../../threadRouteScope";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Button } from "../ui/button";

export function SidechatSurface({
  hostRef,
  surface,
  renderConversation,
}: {
  hostRef: ScopedThreadRef;
  renderConversation: (childRef: ScopedThreadRef, toolId: string | undefined) => ReactNode;
  surface: Extract<RightPanelSurface, { kind: "sidechat" | "sidechat-tool" }>;
}) {
  const childRef = scopeThreadRef(surface.environmentId, surface.threadId);
  const child = useQuietThreadShell(childRef);
  const project = useProject(child ? scopeProjectRef(child.environmentId, child.projectId) : null);
  const environment = useEnvironment(surface.environmentId);
  const toolId = surface.kind === "sidechat-tool" ? surface.surfaceId : undefined;
  const tool = useRightPanelStore((state) =>
    toolId
      ? selectThreadRightPanelState(state.byThreadKey, childRef).surfaces.find(
          (entry) => entry.id === toolId,
        )
      : null,
  );
  useEffect(() => {
    if (toolId && !tool) useRightPanelStore.getState().closeSurface(hostRef, surface.id);
  }, [toolId, tool, hostRef, surface.id]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-sidechat-pane="">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to host"
          onClick={() => useRightPanelStore.getState().close(hostRef)}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">
            {surface.kind === "sidechat-tool" ? `${SIDECHAT_TOOL_LABELS[surface.toolKind]} · ` : ""}
            {child?.title ?? "Side chat"}
          </p>
          <Tooltip>
            <TooltipTrigger render={<p className="truncate text-2xs text-muted-foreground" />}>
              {environment?.label ?? surface.environmentId} ·{" "}
              {child?.worktreePath ?? project?.workspaceRoot ?? "Checkout unavailable"}
            </TooltipTrigger>
            <TooltipPopup>
              {environment?.label ?? surface.environmentId} ·{" "}
              {child?.worktreePath ?? project?.workspaceRoot ?? "Checkout unavailable"}
            </TooltipPopup>
          </Tooltip>
        </div>
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId: childRef.environmentId, threadId: childRef.threadId }}
          aria-label="Open side chat in top tab"
          className="grid size-7 shrink-0 place-items-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ExternalLinkIcon className="size-3.5" />
        </Link>
      </div>
      <ThreadRouteScope value={childRef}>{renderConversation(childRef, toolId)}</ThreadRouteScope>
    </div>
  );
}
