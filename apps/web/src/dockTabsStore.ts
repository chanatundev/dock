// Adapted from Synara revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.

import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { DraftId } from "./composerDraftStore";
import {
  addDockTab,
  closeDockTab,
  moveDockTab,
  normalizeDockTabRefs,
  replaceDraftDockTab,
  type DockTabRef,
} from "./dockTabs.logic";
import { createMemoryStorage, type StateStorage } from "./lib/storage";

export interface DockTabsStoreState {
  tabs: readonly DockTabRef[];
  openTab: (tab: DockTabRef) => void;
  closeTab: (tabId: string, currentActiveTabId: string | null) => { readonly href: string } | null;
  moveTab: (activeId: string, overId: string) => void;
  promoteDraft: (draftId: DraftId, serverRef: ScopedThreadRef) => void;
  setTabs: (tabs: readonly DockTabRef[]) => void;
  clearTabs: () => void;
}

export function resolveSafeStorage(
  storage?: Partial<StateStorage> | null | undefined,
): StateStorage {
  const memoryFallback = createMemoryStorage();
  if (!storage || typeof storage.getItem !== "function") {
    return memoryFallback;
  }

  const writeFailedKeys = new Set<string>();

  return {
    getItem: (key: string): string | null => {
      if (writeFailedKeys.has(key)) {
        return (memoryFallback.getItem(key) as string | null) ?? null;
      }
      try {
        const value = storage.getItem!(key);
        if (typeof value === "string") {
          return value;
        }
      } catch {
        // Fall back to memory cache if backing storage throws
      }
      return (memoryFallback.getItem(key) as string | null) ?? null;
    },
    setItem: (key: string, value: string): void => {
      memoryFallback.setItem(key, value);
      if (typeof storage.setItem !== "function") {
        writeFailedKeys.add(key);
        return;
      }
      try {
        storage.setItem(key, value);
        writeFailedKeys.delete(key);
      } catch {
        // Backing write failed (quota exceeded or restricted): retain in memory fallback
        writeFailedKeys.add(key);
      }
    },
    removeItem: (key: string): void => {
      memoryFallback.removeItem(key);
      if (typeof storage.removeItem !== "function") {
        writeFailedKeys.add(key);
        return;
      }
      try {
        storage.removeItem(key);
        writeFailedKeys.delete(key);
      } catch {
        writeFailedKeys.add(key);
      }
    },
  };
}

function getSafeBrowserLocalStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const DOCK_TOP_TABS_STORAGE_KEY = "t3code:dock-top-tabs:v1";

export const useDockTabsStore = create<DockTabsStoreState>()(
  persist(
    (set, get) => ({
      tabs: [],
      openTab: (tab) => {
        const current = get().tabs;
        const next = addDockTab(current, tab);
        if (next !== current) {
          set({ tabs: next });
        }
      },
      closeTab: (tabId, currentActiveTabId) => {
        const current = get().tabs;
        const { tabs: next, nextTarget } = closeDockTab(current, tabId, currentActiveTabId);
        if (next !== current) {
          set({ tabs: next });
        }
        return nextTarget;
      },
      moveTab: (activeId, overId) => {
        const current = get().tabs;
        const next = moveDockTab(current, activeId, overId);
        if (next !== current) {
          set({ tabs: next });
        }
      },
      promoteDraft: (draftId, serverRef) => {
        const current = get().tabs;
        const next = replaceDraftDockTab(current, draftId, serverRef);
        if (next !== current) {
          set({ tabs: next });
        }
      },
      setTabs: (tabs) => {
        set({ tabs: normalizeDockTabRefs(tabs) });
      },
      clearTabs: () => {
        if (get().tabs.length > 0) {
          set({ tabs: [] });
        }
      },
    }),
    {
      name: DOCK_TOP_TABS_STORAGE_KEY,
      storage: createJSONStorage(() => resolveSafeStorage(getSafeBrowserLocalStorage())),
      version: 1,
      merge: (persistedState, currentState) => {
        const rawTabs = (persistedState as Partial<Pick<DockTabsStoreState, "tabs">> | null)?.tabs;
        return {
          ...currentState,
          tabs: normalizeDockTabRefs(rawTabs),
        };
      },
      migrate: (persisted) => {
        const tabs = (persisted as Partial<Pick<DockTabsStoreState, "tabs">> | null)?.tabs;
        return {
          tabs: normalizeDockTabRefs(tabs),
        };
      },
      partialize: ({ tabs }) => ({
        tabs: normalizeDockTabRefs(tabs),
      }),
    },
  ),
);
