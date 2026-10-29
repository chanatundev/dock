// Adapted from Synara revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  CalendarClock,
  Network,
  ChevronDown,
  Home,
  Inbox,
  ListTodo,
  MessageSquare,
  Settings,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useComposerDraftStore } from "~/composerDraftStore";
import {
  buildThreadTabId,
  coordinateRouteTransition,
  findHiddenSurfaceTabIndexes,
  parseRouteToTabRef,
  type DockTabKind,
  type DockTabRef,
} from "~/dockTabs.logic";
import { useDockTabsStore } from "~/dockTabsStore";
import { isElectron } from "~/env";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { useQuietThreadShells } from "~/state/entities";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

function escapeAttrValue(value: string): string {
  if (typeof window !== "undefined" && window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function TabIcon({ kind }: { readonly kind: DockTabKind }) {
  switch (kind) {
    case "thread":
      return <MessageSquare className="size-3.5 shrink-0" />;
    case "draft":
      return <MessageSquare className="size-3.5 shrink-0 opacity-70" />;
    case "pull-requests":
      return <PullRequestGlyph.pullRequest className="size-3.5 shrink-0" />;
    case "hubs":
      return <Network className="size-3.5 shrink-0" />;
    case "automations":
      return <CalendarClock className="size-3.5 shrink-0" />;
    case "tasks":
      return <ListTodo className="size-3.5 shrink-0" />;
    case "inbox":
      return <Inbox className="size-3.5 shrink-0" />;
    case "usage":
      return <Activity className="size-3.5 shrink-0" />;
    case "settings":
      return <Settings className="size-3.5 shrink-0" />;
    case "home":
      return <Home className="size-3.5 shrink-0" />;
    default:
      return <MessageSquare className="size-3.5 shrink-0" />;
  }
}

function resolveTabTitle(tab: DockTabRef, titles: Map<string, string>): string {
  if (tab.title) return tab.title;

  switch (tab.kind) {
    case "thread": {
      if (tab.environmentId && tab.threadId) {
        const title = titles.get(tab.id);
        if (title) return title;
      }
      return "Thread";
    }
    case "draft":
      return "New thread";
    case "pull-requests":
      return "Code Review";
    case "hubs":
      return "Hubs";
    case "automations":
      return "Automations";
    case "tasks":
      return "Tasks";
    case "inbox":
      return "Inbox";
    case "usage":
      return "Usage";
    case "settings":
      return "Settings";
    case "home":
      return "Home";
    default:
      return "View";
  }
}

interface DockTopTabItemProps {
  readonly tab: DockTabRef;
  readonly active: boolean;
  readonly title: string;
  readonly reducedMotion: boolean;
  readonly onSelect: (tab: DockTabRef) => void;
  readonly onClose: (tabId: string) => void;
  readonly onMoveRelative: (tabId: string, delta: number) => void;
  readonly onNavigateRelative: (currentId: string, delta: number) => void;
  readonly onNavigateBoundary: (boundary: "first" | "last") => void;
}

function SortableDockTabChip({
  tab,
  active,
  title,
  reducedMotion,
  onSelect,
  onClose,
  onMoveRelative,
  onNavigateRelative,
  onNavigateBoundary,
}: DockTopTabItemProps) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
  };

  const handleAuxClick = (e: ReactMouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      onClose(tab.id);
    }
  };

  const handleCloseClick = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose(tab.id);
  };

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.altKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      e.stopPropagation();
      onMoveRelative(tab.id, e.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(tab);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onClose(tab.id);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onNavigateRelative(tab.id, 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      onNavigateRelative(tab.id, -1);
    } else if (e.key === "Home") {
      e.preventDefault();
      onNavigateBoundary("first");
    } else if (e.key === "End") {
      e.preventDefault();
      onNavigateBoundary("last");
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-surface-tab
      data-tab-id={tab.id}
      className={cn(
        "group/dock-tab relative flex h-7 max-w-56 min-w-[110px] flex-1 shrink-0 items-center justify-between gap-1 rounded-md px-1.5 text-xs transition-colors motion-reduce:transition-none [-webkit-app-region:no-drag]",
        active
          ? "bg-background text-foreground shadow-xs font-medium"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        isDragging && "z-50 opacity-40 shadow-md",
      )}
      {...listeners}
      onAuxClick={handleAuxClick}
    >
      <button
        type="button"
        role="tab"
        aria-controls="dock-active-view"
        aria-selected={active}
        aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Delete"
        tabIndex={active ? 0 : -1}
        onClick={() => onSelect(tab)}
        onKeyDown={handleKeyDown}
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left bg-transparent border-0 p-0 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring rounded-xs"
      >
        <TabIcon kind={tab.kind} />
        <Tooltip>
          <TooltipTrigger
            render={<span className="min-w-0 flex-1 truncate select-none">{title}</span>}
          />
          <TooltipPopup side="bottom" sideOffset={6}>
            {title}
          </TooltipPopup>
        </Tooltip>
      </button>

      <button
        type="button"
        aria-label={`Close ${title}`}
        tabIndex={-1}
        onClick={handleCloseClick}
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-sm transition-opacity motion-reduce:transition-none hover:bg-foreground/10 focus-visible:opacity-100",
          active
            ? "opacity-70 hover:opacity-100"
            : "opacity-0 group-hover/dock-tab:opacity-100 group-focus-within/dock-tab:opacity-100",
        )}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

export function DockTopTabs() {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const location = useLocation();
  const navigate = useNavigate();

  const tabs = useDockTabsStore((state) => state.tabs);
  const closeTab = useDockTabsStore((state) => state.closeTab);
  const moveTab = useDockTabsStore((state) => state.moveTab);

  const quietShells = useQuietThreadShells();
  const threadTitles = new Map<string, string>();
  for (const shell of quietShells) {
    if (shell.title && shell.title.trim().length > 0) {
      threadTitles.set(buildThreadTabId(shell.environmentId, shell.id), shell.title);
    }
  }

  const currentTabRef = parseRouteToTabRef(location);
  const activeTabId = currentTabRef?.id ?? null;

  const pendingClosedRouteRef = useRef<string | null>(null);

  useEffect(() => {
    const routeTab = parseRouteToTabRef(location);
    if (!routeTab) return;
    if (pendingClosedRouteRef.current === routeTab.href) {
      return;
    }
    pendingClosedRouteRef.current = null;

    const store = useDockTabsStore.getState();
    const composerStore = useComposerDraftStore.getState();

    const nextTabs = coordinateRouteTransition({
      tabs: store.tabs,
      activeRoute: routeTab,
      getPromotedDraftId: (ref) => composerStore.getDraftIdByRef(ref),
      getDraftPromotedTo: (draftId) => composerStore.getDraftSession(draftId)?.promotedTo ?? null,
      isIntentionalHomeAfterCloseAll: store.tabs.length === 0,
    });

    if (nextTabs !== store.tabs) {
      store.setTabs(nextTabs);
    }
  }, [location]);

  const onSelectTab = useStableCallback((tab: DockTabRef) => {
    void navigate({ href: tab.href });
  });

  const onCloseTab = useStableCallback((tabId: string) => {
    if (tabId === activeTabId && currentTabRef) {
      pendingClosedRouteRef.current = currentTabRef.href;
    }
    const nextTarget = closeTab(tabId, activeTabId);
    if (nextTarget) {
      void navigate({ href: nextTarget.href });
    }
  });

  const onMoveTab = useStableCallback((activeId: string, overId: string) => {
    moveTab(activeId, overId);
  });
  const onMoveRelative = useStableCallback((id: string, delta: number) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const target = index < 0 ? undefined : tabs[index + delta];
    if (target) moveTab(id, target.id);
  });

  const stripRef = useRef<HTMLDivElement>(null);
  const revealActiveTab = useStableCallback(() => {
    const strip = stripRef.current;
    if (!strip || !activeTabId) return;
    const activeEl = strip.querySelector<HTMLElement>(
      `[data-surface-tab][data-tab-id="${escapeAttrValue(activeTabId)}"]`,
    );
    if (!activeEl) return;
    const stripRect = strip.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    if (activeRect.left < stripRect.left) strip.scrollLeft -= stripRect.left - activeRect.left;
    else if (activeRect.right > stripRect.right)
      strip.scrollLeft += activeRect.right - stripRect.right;
  });

  const focusTabById = useStableCallback((id: string) => {
    const btn = stripRef.current?.querySelector<HTMLElement>(
      `[data-tab-id="${escapeAttrValue(id)}"] [role="tab"]`,
    );
    btn?.focus();
  });

  const onNavigateRelative = useStableCallback((currentId: string, delta: number) => {
    const currentIndex = tabs.findIndex((t) => t.id === currentId);
    if (currentIndex === -1) return;
    const targetIndex = currentIndex + delta;
    if (targetIndex >= 0 && targetIndex < tabs.length) {
      const targetTab = tabs[targetIndex];
      if (targetTab) {
        focusTabById(targetTab.id);
        void navigate({ href: targetTab.href });
      }
    }
  });

  const onNavigateBoundary = useStableCallback((boundary: "first" | "last") => {
    const targetTab = boundary === "first" ? tabs[0] : tabs[tabs.length - 1];
    if (targetTab) {
      focusTabById(targetTab.id);
      void navigate({ href: targetTab.href });
    }
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onMoveTab(String(active.id), String(over.id));
    }
  };

  const [hiddenTabIndexes, setHiddenTabIndexes] = useState<readonly number[]>([]);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const stripRect = strip.getBoundingClientRect();
      const tabElements = Array.from(strip.querySelectorAll<HTMLElement>("[data-surface-tab]"));
      const spans = tabElements.map((el) => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });

      const next = findHiddenSurfaceTabIndexes(
        { left: stripRect.left, right: stripRect.right },
        spans,
      );

      setHiddenTabIndexes((prev) =>
        prev.length === next.length && prev.every((val, i) => val === next[i]) ? prev : next,
      );
    };

    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(measure);
    };

    schedule();
    const stopObserving = observeResize(strip, () => {
      revealActiveTab();
      schedule();
    });
    const mutations = new MutationObserver(schedule);
    mutations.observe(strip, { childList: true, subtree: true, characterData: true });
    strip.addEventListener("scroll", schedule, { passive: true });

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      stopObserving();
      mutations.disconnect();
      strip.removeEventListener("scroll", schedule);
    };
  }, [tabs.length > 0, revealActiveTab]);

  useLayoutEffect(() => {
    if (tabs.some((tab) => tab.id === activeTabId)) revealActiveTab();
  }, [activeTabId, tabs, revealActiveTab]);

  const hiddenTabs = hiddenTabIndexes.flatMap((index) => {
    const tab = tabs[index];
    return tab ? [tab] : [];
  });

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex h-[var(--workspace-topbar-height)] shrink-0 items-center justify-between border-b border-border/40 bg-muted/20 px-2 select-none",
        isElectron && "drag-region",
        isElectron && "wco:pr-(--workspace-native-controls-inset)",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
      data-dock-top-tabs
    >
      <nav
        ref={stripRef}
        role="tablist"
        aria-label="Open tabs"
        aria-description="Use arrow keys to switch tabs. Alt+Shift+Left or Right reorders a tab. Delete closes its view."
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis, restrictToFirstScrollableAncestor]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab) => {
              const active = tab.id === activeTabId;
              const title = resolveTabTitle(tab, threadTitles);
              return (
                <SortableDockTabChip
                  key={tab.id}
                  tab={tab}
                  active={active}
                  title={title}
                  reducedMotion={reducedMotion}
                  onSelect={onSelectTab}
                  onClose={onCloseTab}
                  onMoveRelative={onMoveRelative}
                  onNavigateRelative={onNavigateRelative}
                  onNavigateBoundary={onNavigateBoundary}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </nav>

      {hiddenTabs.length > 0 && (
        <div className="flex shrink-0 items-center pl-1 [-webkit-app-region:no-drag]">
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label={`${hiddenTabs.length} hidden ${hiddenTabs.length === 1 ? "tab" : "tabs"}`}
                  size="icon-xs"
                  variant="ghost-muted"
                />
              }
            >
              <ChevronDown className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" side="bottom" sideOffset={4} className="w-56">
              {hiddenTabs.map((tab) => {
                const title = resolveTabTitle(tab, threadTitles);
                return (
                  <MenuItem key={tab.id} onClick={() => onSelectTab(tab)}>
                    <TabIcon kind={tab.kind} />
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                  </MenuItem>
                );
              })}
            </MenuPopup>
          </Menu>
        </div>
      )}
    </div>
  );
}
