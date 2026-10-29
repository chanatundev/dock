import { userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { render } from "../../../test/render";
import { DockTaskEditor } from "./DockTaskEditor";

it("keeps typed values through deferred form updates and saves them explicitly", async () => {
  const onSave = vi.fn(async () => {});
  // This form has no route behavior; isolate the event lifecycle from the application router.
  await using screen = await render(
    <DockTaskEditor
      initialValues={{ title: "", notes: "", priority: "none", dueDate: null, project: null }}
      projectOptions={[]}
      submitLabel="Create Task"
      onSave={onSave}
    />,
    { router: false },
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Title", exact: true }),
    "Investigate a failure",
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Notes", exact: true }),
    "Keep the existing work.",
  );
  await expect
    .element(screen.getByRole("textbox", { name: "Title", exact: true }))
    .toHaveValue("Investigate a failure");
  expect(onSave).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Create Task", exact: true }));
  expect(onSave).toHaveBeenCalledWith({
    title: "Investigate a failure",
    notes: "Keep the existing work.",
    priority: "none",
    dueDate: null,
    project: null,
  });
});

it("warns only when the selected project label is missing or disabled", async () => {
  const project = { environmentId: EnvironmentId.make("owner"), projectId: ProjectId.make("app") };
  const initialValues = {
    title: "Work",
    notes: "",
    priority: "none" as const,
    dueDate: null,
    project,
  };
  const onSave = vi.fn(async () => {});
  // Project availability is supplied to this form; it does not depend on application routing.
  await using screen = await render(
    <DockTaskEditor
      initialValues={initialValues}
      projectOptions={[{ project, label: "App" }]}
      submitLabel="Save"
      onSave={onSave}
    />,
    { router: false },
  );
  await expect
    .element(screen.getByRole("combobox", { name: "Project label" }))
    .toHaveTextContent("App");
  await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  await screen.rerender(
    <DockTaskEditor
      initialValues={initialValues}
      projectOptions={[{ project, label: "App", disabled: true }]}
      submitLabel="Save"
      onSave={onSave}
    />,
  );
  await expect.element(screen.getByRole("status")).toBeVisible();
  await screen.rerender(
    <DockTaskEditor
      initialValues={initialValues}
      projectOptions={[]}
      submitLabel="Save"
      onSave={onSave}
    />,
  );
  await expect.element(screen.getByRole("status")).toBeVisible();
});
