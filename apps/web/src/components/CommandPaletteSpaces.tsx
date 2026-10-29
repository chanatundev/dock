import { OrbitIcon } from "lucide-react";
import { useDockSpacesStore } from "../dockSpacesStore";
import { encodeDockSpaceSelection, type DockSpaceSelection } from "../dockSpaces.logic";
import { useDockSpaceEnvironments } from "../state/spaces";
import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "./CommandPalette.logic";

export function useCommandPaletteSpaceItems(): CommandPaletteActionItem[] {
  const { environments } = useDockSpaceEnvironments();
  const select = useDockSpacesStore((store) => store.setSelection);
  const makeItem = (
    selection: DockSpaceSelection,
    title: string,
    description: string,
  ): CommandPaletteActionItem => ({
    kind: "action",
    value: "space:" + encodeDockSpaceSelection(selection),
    title,
    description,
    searchTerms: ["hub", "hubs", "projects", title, description],
    icon: <OrbitIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      select(selection);
    },
  });
  return [
    makeItem({ kind: "all" }, "Show all projects", "Hub filter"),
    ...environments.flatMap((environment) =>
      environment.snapshot === null || environment.status === "unsupported"
        ? []
        : [
            makeItem(
              { kind: "void", environmentId: environment.environmentId },
              "Switch to Void",
              environment.label,
            ),
            ...environment.snapshot.spaces.map((space) =>
              makeItem(
                { kind: "space", environmentId: environment.environmentId, spaceId: space.id },
                "Switch to Hub: " + space.name,
                environment.label,
              ),
            ),
          ],
    ),
  ];
}
