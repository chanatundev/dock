import { EnvironmentId, SpaceId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { useDockSpacesStore } from "./dockSpacesStore";
import { useThreadSelectionStore } from "./threadSelectionStore";

it("clears bulk thread selection when changing Space so hidden work cannot remain selected", () => {
  const spaces = useDockSpacesStore.getState();
  const threads = useThreadSelectionStore.getState();
  spaces.setSelection({ kind: "all" });
  threads.toggleThread("local:thread");
  const selected = {
    kind: "space" as const,
    environmentId: EnvironmentId.make("local"),
    spaceId: SpaceId.make("work"),
  };
  spaces.setSelection(selected);
  expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(0);
  threads.toggleThread("local:visible-thread");
  spaces.setSelection({ ...selected });
  expect(useThreadSelectionStore.getState().selectedThreadKeys).toEqual(
    new Set(["local:visible-thread"]),
  );
  spaces.setSelection({ kind: "all" });
});
