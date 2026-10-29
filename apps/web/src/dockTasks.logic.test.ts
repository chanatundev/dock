import { describe, expect, it } from "vite-plus/test";
import { parseRouteToTabRef, normalizeDockTabRefs, addDockTab } from "./dockTabs.logic";
import { validateDockTasksSearch } from "./dockTasks.logic";

describe("Task list search", () => {
  it("keeps environment-scoped selection inside one restorable Tasks tab", () => {
    const first = parseRouteToTabRef({
      pathname: "/tasks",
      search: { environmentId: "env:a", taskId: "task:b" },
    })!;
    const next = parseRouteToTabRef({
      pathname: "/tasks",
      search: { environmentId: "env:b", taskId: "task:a" },
    })!;
    expect(normalizeDockTabRefs(addDockTab([first], next))).toEqual([next]);
    expect(next.href).toContain("environmentId=env%3Ab");
  });

  it("discards incomplete selections and preserves spaces while typing", () => {
    expect(validateDockTasksSearch({ environmentId: "env", taskId: "", q: 1 })).toEqual({
      archived: false,
    });
    expect(validateDockTasksSearch({ q: "review " }).q).toBe("review ");
    expect(parseRouteToTabRef({ pathname: "/tasks/invalid" })).toBeNull();
  });
});
