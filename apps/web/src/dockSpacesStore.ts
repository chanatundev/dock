import { create } from "zustand";
import { useThreadSelectionStore } from "./threadSelectionStore";

import {
  ALL_DOCK_PROJECTS,
  decodeDockSpaceSelection,
  encodeDockSpaceSelection,
  sameDockSpaceSelection,
  type DockSpaceSelection,
} from "./dockSpaces.logic";

const STORAGE_KEY = "t3:dock-spaces-selection:v1";

function readSelection(): DockSpaceSelection {
  if (typeof window === "undefined") return ALL_DOCK_PROJECTS;
  try {
    return decodeDockSpaceSelection(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return ALL_DOCK_PROJECTS;
  }
}

function persistSelection(selection: DockSpaceSelection): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, encodeDockSpaceSelection(selection));
  } catch {
    // A blocked storage API must not make Space switching unusable.
  }
}

interface DockSpacesStore {
  readonly selection: DockSpaceSelection;
  setSelection: (selection: DockSpaceSelection) => void;
}

export const useDockSpacesStore = create<DockSpacesStore>((set, get) => ({
  selection: readSelection(),
  setSelection: (selection) => {
    if (sameDockSpaceSelection(get().selection, selection)) return;
    useThreadSelectionStore.getState().clearSelection();
    persistSelection(selection);
    set({ selection });
  },
}));
