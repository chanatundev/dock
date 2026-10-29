// Navigation arrangement adapted from Synara revision 3f55b77ef186764050ecf4edd6ae0879eec948a8.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import { Link, useLocation } from "@tanstack/react-router";
import {
  CalendarClockIcon,
  InboxIcon,
  ListTodoIcon,
  NetworkIcon,
  SettingsIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import { DockProviderShowcase } from "./DockProviderShowcase";
import { PullRequestGlyph } from "./pullRequest/pullRequestIcons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useSidebar } from "./ui/sidebar";

export const DOCK_FEATURE_RAIL_WIDTH = 52;
const destinations = [
  { label: "Inbox", to: "/inbox", icon: InboxIcon },
  { label: "Tasks", to: "/tasks", icon: ListTodoIcon },
  { label: "Code Review", to: "/pull-requests", icon: PullRequestGlyph.pullRequest },
  { label: "Automations", to: "/automations", icon: CalendarClockIcon },
  { label: "Hubs", to: "/hubs", icon: NetworkIcon },
] as const;

function FeatureDestinations({ sheet = false }: { sheet?: boolean }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { setOpenMobile } = useSidebar();
  return (
    <nav
      aria-label="Dock features"
      className={cn("flex gap-1", sheet ? "justify-center" : "flex-col items-center")}
    >
      {destinations.map(({ label, to, icon: Icon }) => {
        const active = pathname === to;
        return (
          <Tooltip key={to}>
            <TooltipTrigger
              render={
                <Link
                  to={to}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  onClick={() => sheet && setOpenMobile(false)}
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-lg outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
                  )}
                />
              }
            >
              <Icon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side={sheet ? "top" : "right"}>{label}</TooltipPopup>
          </Tooltip>
        );
      })}
    </nav>
  );
}

export function DockFeatureRail() {
  return (
    <aside
      data-dock-feature-rail=""
      aria-label="Dock navigation"
      className="hidden h-dvh w-13 shrink-0 flex-col border-r bg-sidebar md:flex"
    >
      <div className="h-[var(--workspace-topbar-height)] shrink-0 [-webkit-app-region:drag]" />
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <FeatureDestinations />
      </div>
      <div className="flex min-h-0 shrink flex-col items-center gap-1 pb-2">
        <DockProviderShowcase layout="rail" />
        <div className="shrink-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  to="/settings"
                  aria-label="Settings"
                  className="grid size-10 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            >
              <SettingsIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="right">Settings</TooltipPopup>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}

export function DockSheetFeatureNavigation() {
  return (
    <div className="shrink-0 border-t p-2 md:hidden">
      <FeatureDestinations sheet />
    </div>
  );
}
