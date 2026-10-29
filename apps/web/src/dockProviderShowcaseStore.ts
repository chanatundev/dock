import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { normalizeDockProviderSelections } from "./dockProviderShowcase.logic";
import { resolveSafeStorage } from "./dockTabsStore";

interface DockProviderShowcaseState {
  readonly selectedKeys: readonly string[];
  readonly setSelectedKeys: (keys: readonly string[]) => void;
}

function browserStorage() {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export const DOCK_PROVIDER_SHOWCASE_STORAGE_KEY = "dock:provider-showcase:v1";

export const useDockProviderShowcaseStore = create<DockProviderShowcaseState>()(
  persist(
    (set, get) => ({
      selectedKeys: [],
      setSelectedKeys: (keys) => {
        const selectedKeys = normalizeDockProviderSelections(keys);
        if (
          selectedKeys.length === get().selectedKeys.length &&
          selectedKeys.every((key, index) => key === get().selectedKeys[index])
        )
          return;
        set({ selectedKeys });
      },
    }),
    {
      name: DOCK_PROVIDER_SHOWCASE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => resolveSafeStorage(browserStorage())),
      partialize: ({ selectedKeys }) => ({ selectedKeys }),
      merge: (persisted, current) => ({
        ...current,
        selectedKeys: normalizeDockProviderSelections(
          typeof persisted === "object" && persisted !== null && "selectedKeys" in persisted
            ? persisted.selectedKeys
            : null,
        ),
      }),
    },
  ),
);
