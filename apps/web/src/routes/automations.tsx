import { createFileRoute, redirect } from "@tanstack/react-router";
import { ScheduledTasksSettings } from "../components/settings/ScheduledTasksSettings";
import { validateScheduledTasksSearch } from "../components/settings/scheduledTasksSettings.logic";
import { SettingsScopeProvider } from "../components/settings/SettingsScopeContext";
import { validateSettingsScopeSearch } from "../components/settings/settingsScope";

function AutomationsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SettingsScopeProvider
      search={search}
      onChange={(next) => {
        void navigate({
          search: (previous) => ({
            ...previous,
            project: next.project,
            machine: next.machine,
            checkout: next.checkout,
          }),
          hash: "",
          replace: true,
          resetScroll: false,
        });
      }}
    >
      <ScheduledTasksSettings {...search} />
    </SettingsScopeProvider>
  );
}

export const Route = createFileRoute("/automations")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    )
      throw redirect({ to: "/pair", replace: true });
  },
  validateSearch: (raw) => ({
    ...validateSettingsScopeSearch(raw),
    ...validateScheduledTasksSearch(raw),
  }),
  component: AutomationsRoute,
});
