// Adapted from Synara revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.

import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import type { DraftId } from "./composerDraftStore";

export type DockTabKind =
  | "thread"
  | "draft"
  | "pull-requests"
  | "automations"
  | "hubs"
  | "tasks"
  | "inbox"
  | "usage"
  | "settings"
  | "home";

export interface DockTabRef {
  readonly id: string;
  readonly kind: DockTabKind;
  readonly href: string;
  readonly title?: string | undefined;
  readonly environmentId?: EnvironmentId | undefined;
  readonly threadId?: ThreadId | undefined;
  readonly draftId?: DraftId | undefined;
}

export interface DockTabCloseResult {
  readonly tabs: readonly DockTabRef[];
  readonly nextTarget: { readonly href: string } | null;
}

const CLOSED_DOCK_TABS_HREF = "/?dockTabsClosed=true";

export function shouldBootstrapDockThread(location: {
  readonly pathname: string;
  readonly search: unknown;
}): boolean {
  return (
    location.pathname === "/" &&
    new URLSearchParams(normalizeSearchString(location.search)).get("dockTabsClosed") !== "true"
  );
}

export interface HorizontalSpan {
  readonly left: number;
  readonly right: number;
}

const VISIBILITY_TOLERANCE_PX = 1;

export function findHiddenSurfaceTabIndexes(
  strip: HorizontalSpan,
  tabs: readonly HorizontalSpan[],
): readonly number[] {
  const hidden: number[] = [];
  tabs.forEach((tab, index) => {
    if (
      tab.left < strip.left - VISIBILITY_TOLERANCE_PX ||
      tab.right > strip.right + VISIBILITY_TOLERANCE_PX
    ) {
      hidden.push(index);
    }
  });
  return hidden;
}

const RESERVED_FIRST_SEGMENTS = new Set([
  "",
  "welcome",
  "pair",
  "connect",
  "connect-agent",
  "settings",
  "draft",
  "pull-requests",
  "issues",
  "usage",
  "automations",
  "hubs",
  "tasks",
  "inbox",
  "projects",
  "_chat",
]);

const SENSITIVE_QUERY_KEY_PATTERN = /(?:^|[?&#])(?:token|secret|code|auth|password|key|bearer)=/i;

export function isSafeLocalHref(href: unknown): href is string {
  if (typeof href !== "string") return false;
  const trimmed = href.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return false;
  }
  if (trimmed.includes("://") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return false;
  }
  if (SENSITIVE_QUERY_KEY_PATTERN.test(trimmed)) {
    return false;
  }
  const pathname = trimmed.split(/[?#]/)[0] ?? "";
  if (
    pathname === "/pair" ||
    pathname === "/connect" ||
    pathname === "/connect-agent" ||
    pathname === "/welcome"
  ) {
    return false;
  }
  return true;
}

export function buildThreadTabId(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `thread:${encodeURIComponent(environmentId)}:${encodeURIComponent(threadId)}`;
}

export function parseThreadTabId(
  id: string,
): { readonly environmentId: EnvironmentId; readonly threadId: ThreadId } | null {
  if (!id.startsWith("thread:")) return null;
  const rest = id.slice("thread:".length);
  const colonIndex = rest.indexOf(":");
  if (colonIndex <= 0 || colonIndex >= rest.length - 1) return null;
  const rawEnv = rest.slice(0, colonIndex);
  const rawThread = rest.slice(colonIndex + 1);
  try {
    const environmentId = decodeURIComponent(rawEnv) as EnvironmentId;
    const threadId = decodeURIComponent(rawThread) as ThreadId;
    if (!environmentId || !threadId) return null;
    return { environmentId, threadId };
  } catch {
    return null;
  }
}

export function buildDraftTabId(draftId: DraftId): string {
  return `draft:${encodeURIComponent(draftId)}`;
}

export function parseDraftTabId(id: string): DraftId | null {
  if (!id.startsWith("draft:")) return null;
  const rawDraft = id.slice("draft:".length);
  try {
    const decoded = decodeURIComponent(rawDraft);
    return decoded ? (decoded as DraftId) : null;
  } catch {
    return null;
  }
}

function normalizeSearchString(search: unknown): string {
  if (typeof search === "string") {
    const trimmed = search.trim();
    if (!trimmed) return "";
    return trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
  }
  if (search && typeof search === "object") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null) params.append(key, String(item));
        }
      } else {
        params.append(key, String(value));
      }
    }
    return params.toString();
  }
  return "";
}

function buildHrefWithSearch(pathname: string, search: unknown): string {
  const queryString = normalizeSearchString(search);
  return queryString.length > 0 ? `${pathname}?${queryString}` : pathname;
}

export function parseRouteToTabRef(location: {
  readonly pathname: string;
  readonly search?: unknown;
}): DockTabRef | null {
  const rawPath = location.pathname.trim();
  if (!isSafeLocalHref(rawPath)) return null;

  const pathname = rawPath.startsWith("/_chat/")
    ? `/${rawPath.slice("/_chat/".length)}`
    : rawPath === "/_chat"
      ? "/"
      : rawPath;

  if (pathname === "/") {
    if (!shouldBootstrapDockThread({ pathname, search: location.search })) return null;
    return {
      id: "home",
      kind: "home",
      href: "/",
    };
  }

  if (pathname === "/pull-requests") {
    const href = buildHrefWithSearch(pathname, location.search);
    if (!isSafeLocalHref(href)) return null;
    return {
      id: "pull-requests",
      kind: "pull-requests",
      href,
    };
  }

  if (pathname === "/automations") {
    const href = buildHrefWithSearch(pathname, location.search);
    return isSafeLocalHref(href) ? { id: "automations", kind: "automations", href } : null;
  }

  if (pathname === "/hubs") {
    return { id: "hubs", kind: "hubs", href: "/hubs" };
  }

  if (pathname === "/tasks") {
    const href = buildHrefWithSearch(pathname, location.search);
    return isSafeLocalHref(href) ? { id: "tasks", kind: "tasks", href } : null;
  }

  if (pathname === "/inbox") return { id: "inbox", kind: "inbox", href: "/inbox" };

  if (pathname === "/usage") {
    return {
      id: "usage",
      kind: "usage",
      href: "/usage",
    };
  }

  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    const href = buildHrefWithSearch(pathname, location.search);
    if (!isSafeLocalHref(href)) return null;
    return {
      id: "settings",
      kind: "settings",
      href,
    };
  }

  if (pathname.startsWith("/draft/")) {
    const segments = pathname.slice("/draft/".length).split("/");
    if (segments.length !== 1) return null;
    const rawDraftId = segments[0];
    if (!rawDraftId) return null;
    try {
      const draftId = decodeURIComponent(rawDraftId) as DraftId;
      if (!draftId) return null;
      return {
        id: buildDraftTabId(draftId),
        kind: "draft",
        draftId,
        href: `/draft/${rawDraftId}`,
      };
    } catch {
      return null;
    }
  }

  const segments = pathname.slice(1).split("/");
  if (segments.length === 2) {
    const [rawEnv, rawThread] = segments;
    if (rawEnv && rawThread && !RESERVED_FIRST_SEGMENTS.has(rawEnv)) {
      try {
        const environmentId = decodeURIComponent(rawEnv) as EnvironmentId;
        const threadId = decodeURIComponent(rawThread) as ThreadId;
        if (environmentId && threadId) {
          return {
            id: buildThreadTabId(environmentId, threadId),
            kind: "thread",
            environmentId,
            threadId,
            href: `/${rawEnv}/${rawThread}`,
          };
        }
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function addDockTab(tabs: readonly DockTabRef[], newTab: DockTabRef): readonly DockTabRef[] {
  const existingIndex = tabs.findIndex((t) => t.id === newTab.id);
  if (existingIndex !== -1) {
    const existing = tabs[existingIndex];
    if (existing && existing.href === newTab.href && existing.title === newTab.title) {
      return tabs;
    }
    const next = [...tabs];
    next[existingIndex] = {
      ...existing,
      ...newTab,
      title: newTab.title ?? existing?.title,
    };
    return next;
  }
  return [...tabs, newTab];
}

function removeDockTab(tabs: readonly DockTabRef[], tabId: string): readonly DockTabRef[] {
  const index = tabs.findIndex((t) => t.id === tabId);
  if (index === -1) return tabs;
  return tabs.filter((t) => t.id !== tabId);
}

export function moveDockTab(
  tabs: readonly DockTabRef[],
  activeId: string,
  overId: string,
): readonly DockTabRef[] {
  if (activeId === overId) return tabs;
  const oldIndex = tabs.findIndex((t) => t.id === activeId);
  const newIndex = tabs.findIndex((t) => t.id === overId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
    return tabs;
  }
  const next = [...tabs];
  const [moved] = next.splice(oldIndex, 1);
  if (!moved) return tabs;
  next.splice(newIndex, 0, moved);
  return next;
}

export function replaceDraftDockTab(
  tabs: readonly DockTabRef[],
  draftId: DraftId,
  serverRef: ScopedThreadRef,
): readonly DockTabRef[] {
  const draftTabId = buildDraftTabId(draftId);
  const index = tabs.findIndex((t) => t.id === draftTabId);
  if (index === -1) return tabs;

  const serverTabId = buildThreadTabId(serverRef.environmentId, serverRef.threadId);
  const existingServerIndex = tabs.findIndex((t) => t.id === serverTabId);
  if (existingServerIndex !== -1 && existingServerIndex !== index) {
    return tabs.filter((t) => t.id !== draftTabId);
  }

  const next = [...tabs];
  next[index] = {
    id: serverTabId,
    kind: "thread",
    environmentId: serverRef.environmentId,
    threadId: serverRef.threadId,
    href: `/${encodeURIComponent(serverRef.environmentId)}/${encodeURIComponent(serverRef.threadId)}`,
  };
  return next;
}

export interface RouteTransitionInput {
  readonly tabs: readonly DockTabRef[];
  readonly activeRoute: DockTabRef | null;
  readonly getPromotedDraftId?: (serverRef: ScopedThreadRef) => DraftId | null;
  readonly getDraftPromotedTo?: (draftId: DraftId) => ScopedThreadRef | null;
  readonly isIntentionalHomeAfterCloseAll?: boolean;
}

export function coordinateRouteTransition(input: RouteTransitionInput): readonly DockTabRef[] {
  const {
    tabs,
    activeRoute,
    getPromotedDraftId,
    getDraftPromotedTo,
    isIntentionalHomeAfterCloseAll,
  } = input;
  if (!activeRoute) return tabs;

  if (activeRoute.kind === "home" && isIntentionalHomeAfterCloseAll && tabs.length === 0) {
    return tabs;
  }

  if (activeRoute.kind === "thread" && activeRoute.environmentId && activeRoute.threadId) {
    const serverRef = { environmentId: activeRoute.environmentId, threadId: activeRoute.threadId };
    const promotedDraftId = getPromotedDraftId?.(serverRef);
    if (promotedDraftId) {
      const draftTabId = buildDraftTabId(promotedDraftId);
      if (tabs.some((t) => t.id === draftTabId)) {
        return replaceDraftDockTab(tabs, promotedDraftId, serverRef);
      }
    }
  }

  if (activeRoute.kind === "draft" && activeRoute.draftId) {
    const promotedTo = getDraftPromotedTo?.(activeRoute.draftId);
    if (promotedTo) {
      return replaceDraftDockTab(tabs, activeRoute.draftId, promotedTo);
    }
  }

  return addDockTab(tabs, activeRoute);
}

function resolveDockTabCloseTarget(
  tabs: readonly DockTabRef[],
  closingTabId: string,
  currentActiveTabId: string | null,
): { readonly href: string } | null {
  if (currentActiveTabId === null || closingTabId !== currentActiveTabId) {
    return null;
  }

  const closingIndex = tabs.findIndex((t) => t.id === closingTabId);
  if (closingIndex === -1) {
    return null;
  }

  if (tabs.length <= 1) {
    return { href: CLOSED_DOCK_TABS_HREF };
  }

  const successor =
    closingIndex < tabs.length - 1 ? tabs[closingIndex + 1] : tabs[closingIndex - 1];

  return successor ? { href: successor.href } : { href: CLOSED_DOCK_TABS_HREF };
}

export function closeDockTab(
  tabs: readonly DockTabRef[],
  closingTabId: string,
  currentActiveTabId: string | null,
): DockTabCloseResult {
  const nextTarget = resolveDockTabCloseTarget(tabs, closingTabId, currentActiveTabId);
  const remainingTabs = removeDockTab(tabs, closingTabId);
  return { tabs: remainingTabs, nextTarget };
}

export function normalizeDockTabRefs(raw: unknown): readonly DockTabRef[] {
  if (!Array.isArray(raw)) return [];
  const result: DockTabRef[] = [];
  const seenIds = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<DockTabRef>;
    if (!isSafeLocalHref(candidate.href)) continue;

    const parsed = parseRouteToTabRef({
      pathname: candidate.href.split(/[?#]/)[0] ?? "",
      search: candidate.href.includes("?") ? candidate.href.split("?")[1] : undefined,
    });
    if (!parsed) continue;

    if (candidate.kind !== parsed.kind) continue;

    switch (candidate.kind) {
      case "thread": {
        if (
          typeof candidate.environmentId !== "string" ||
          !candidate.environmentId ||
          typeof candidate.threadId !== "string" ||
          !candidate.threadId
        ) {
          continue;
        }
        if (
          candidate.environmentId !== parsed.environmentId ||
          candidate.threadId !== parsed.threadId
        ) {
          continue;
        }
        const canonicalId = buildThreadTabId(candidate.environmentId, candidate.threadId);
        if (candidate.id !== undefined && candidate.id !== canonicalId) {
          continue;
        }
        if (seenIds.has(canonicalId)) continue;
        seenIds.add(canonicalId);
        result.push({
          id: canonicalId,
          kind: "thread",
          href: candidate.href,
          environmentId: candidate.environmentId,
          threadId: candidate.threadId,
          title: typeof candidate.title === "string" ? candidate.title : undefined,
        });
        break;
      }
      case "draft": {
        if (typeof candidate.draftId !== "string" || !candidate.draftId) continue;
        if (candidate.draftId !== parsed.draftId) continue;
        const canonicalId = buildDraftTabId(candidate.draftId);
        if (candidate.id !== undefined && candidate.id !== canonicalId) {
          continue;
        }
        if (seenIds.has(canonicalId)) continue;
        seenIds.add(canonicalId);
        result.push({
          id: canonicalId,
          kind: "draft",
          href: candidate.href,
          draftId: candidate.draftId,
          title: typeof candidate.title === "string" ? candidate.title : undefined,
        });
        break;
      }
      case "pull-requests":
      case "automations":
      case "hubs":
      case "tasks":
      case "inbox":
      case "usage":
      case "settings":
      case "home": {
        if (candidate.id !== undefined && candidate.id !== parsed.id) {
          continue;
        }
        if (seenIds.has(parsed.id)) continue;
        seenIds.add(parsed.id);
        result.push({
          id: parsed.id,
          kind: parsed.kind,
          href: parsed.href,
          title: typeof candidate.title === "string" ? candidate.title : undefined,
        });
        break;
      }
    }
  }

  return result;
}
