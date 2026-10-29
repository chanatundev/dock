import { createFileRoute, redirect } from "@tanstack/react-router";
import { DockTasksPage } from "../components/tasks/DockTasksPage";
import { validateDockTasksSearch } from "../dockTasks.logic";

export const Route = createFileRoute("/tasks")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  validateSearch: validateDockTasksSearch,
  component: DockTasksPage,
});
