// Space vocabulary/icons adapted from Synara's SpaceSwitcher.tsx and SpaceIcon.tsx,
// revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import { useAtomValue } from "@effect/atom-react";
import {
  CommandId,
  SpaceId,
  SpaceIcon,
  SPACE_NAME_MAX_LENGTH,
  type EnvironmentId,
  type SpaceCommand,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BackpackIcon,
  BookIcon,
  BriefcaseBusinessIcon,
  CameraIcon,
  ChartNoAxesCombinedIcon,
  ChevronDownIcon,
  CloudIcon,
  CodeIcon,
  FlaskConicalIcon,
  Gamepad2Icon,
  GlobeIcon,
  GraduationCapIcon,
  HammerIcon,
  HeartIcon,
  HouseIcon,
  LightbulbIcon,
  OrbitIcon,
  PaletteIcon,
  PlusIcon,
  RocketIcon,
  Settings2Icon,
  StarIcon,
  TargetIcon,
  TreePineIcon,
} from "lucide-react";
import { useState } from "react";
import { randomUUID } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { waitForAtomValue } from "../state/waitForAtomValue";
import { dockSpaceEnvironmentAtom } from "../state/spaces";
import { toastManager } from "./ui/toast";

import { useDockSpacesStore } from "../dockSpacesStore";
import { encodeDockSpaceSelection, type DockSpaceEnvironmentState } from "../dockSpaces.logic";
import { useProjects } from "../state/entities";
import { environmentIdsKey } from "../state/environmentAtomList";
import { dockSpaceMutationPermissions, useDockSpaceEnvironments } from "../state/spaces";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuGroup,
  MenuGroupLabel,
  MenuSeparator,
} from "./ui/menu";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "./ui/select";

const SPACE_ICONS = {
  bag: BriefcaseBusinessIcon,
  home: HouseIcon,
  "code-brackets": CodeIcon,
  rocket: RocketIcon,
  "light-bulb": LightbulbIcon,
  "color-palette": PaletteIcon,
  book: BookIcon,
  lab: FlaskConicalIcon,
  heart: HeartIcon,
  star: StarIcon,
  globe: GlobeIcon,
  cloud: CloudIcon,
  hammer: HammerIcon,
  "chart-2": ChartNoAxesCombinedIcon,
  gamecontroller: Gamepad2Icon,
  "camera-1": CameraIcon,
  target: TargetIcon,
  tree: TreePineIcon,
  school: GraduationCapIcon,
  backpack: BackpackIcon,
} satisfies Record<typeof SpaceIcon.Type, typeof BriefcaseBusinessIcon>;

const SPACE_ICON_LABELS = {
  bag: "Bag",
  home: "Home",
  "code-brackets": "Code",
  rocket: "Rocket",
  "light-bulb": "Idea",
  "color-palette": "Palette",
  book: "Book",
  lab: "Lab",
  heart: "Heart",
  star: "Star",
  globe: "Globe",
  cloud: "Cloud",
  hammer: "Hammer",
  "chart-2": "Chart",
  gamecontroller: "Games",
  "camera-1": "Camera",
  target: "Target",
  tree: "Tree",
  school: "School",
  backpack: "Backpack",
} satisfies Record<typeof SpaceIcon.Type, string>;
const SPACE_ICON_OPTIONS = SpaceIcon.literals.map((value) => ({
  value,
  label: SPACE_ICON_LABELS[value],
}));

function SpaceGlyph({ icon }: { icon: typeof SpaceIcon.Type }) {
  const Icon = SPACE_ICONS[icon];
  return <Icon className="size-4 shrink-0" />;
}

export function DockSpacesSwitcher() {
  const { environments, environmentIds } = useDockSpaceEnvironments();
  const selection = useDockSpacesStore((store) => store.selection);
  const select = useDockSpacesStore((store) => store.setSelection);
  const permissions = useAtomValue(dockSpaceMutationPermissions(environmentIdsKey(environmentIds)));
  const [editor, setEditor] = useState<{
    environmentId: EnvironmentId;
    spaceId: SpaceId | null;
  } | null>(null);
  const owner =
    selection.kind === "all"
      ? undefined
      : environments.find((item) => item.environmentId === selection.environmentId);
  const selectedSpace =
    selection.kind === "space"
      ? owner?.snapshot?.spaces.find((space) => space.id === selection.spaceId)
      : undefined;
  const title =
    selection.kind === "all"
      ? "All projects"
      : selection.kind === "void"
        ? "Void"
        : (selectedSpace?.name ?? "Hub");
  const available = environments.some((item) => item.supportsDockSpaces || item.snapshot !== null);
  if (!available && selection.kind === "all") return null;
  return (
    <div className="shrink-0 px-3 pb-2">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <Menu>
            <MenuTrigger render={<Button variant="outline" size="sm" />}>
              {selectedSpace ? (
                <SpaceGlyph icon={selectedSpace.icon} />
              ) : (
                <OrbitIcon className="size-4" />
              )}
              <span className="min-w-0 truncate">{title}</span>
              <ChevronDownIcon className="size-3" />
            </MenuTrigger>
            <MenuPopup align="start">
              <MenuItem onClick={() => select({ kind: "all" })}>All projects</MenuItem>
              {environments.map((environment, index) => (
                <MenuGroup key={environment.environmentId}>
                  <MenuSeparator />
                  <MenuGroupLabel>
                    {environment.label}
                    {environment.status === "ready" ? "" : " · " + environment.status}
                  </MenuGroupLabel>
                  <MenuItem
                    disabled={environment.snapshot === null || environment.status === "unsupported"}
                    onClick={() =>
                      select({ kind: "void", environmentId: environment.environmentId })
                    }
                  >
                    <OrbitIcon />
                    Void
                  </MenuItem>
                  {environment.snapshot?.spaces.map((space) => (
                    <MenuItem
                      key={space.id}
                      disabled={environment.status === "unsupported"}
                      onClick={() =>
                        select({
                          kind: "space",
                          environmentId: environment.environmentId,
                          spaceId: space.id,
                        })
                      }
                    >
                      <SpaceGlyph icon={space.icon} />
                      {space.name}
                    </MenuItem>
                  ))}
                  <MenuItem
                    disabled={environment.status !== "ready" || !permissions[index]}
                    onClick={() =>
                      setEditor({ environmentId: environment.environmentId, spaceId: null })
                    }
                  >
                    <PlusIcon />
                    New Hub
                  </MenuItem>
                </MenuGroup>
              ))}
            </MenuPopup>
          </Menu>
        </div>
        {selectedSpace && owner ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={"Manage Hub " + selectedSpace.name}
            onClick={() =>
              setEditor({ environmentId: owner.environmentId, spaceId: selectedSpace.id })
            }
          >
            <Settings2Icon />
          </Button>
        ) : null}
      </div>
      {owner ? (
        <p className="mt-1 truncate text-2xs text-muted-foreground">
          {owner.label}
          {owner.status === "ready"
            ? ""
            : " · " +
              owner.status +
              (owner.snapshot === null ||
              owner.status === "unsupported" ||
              !owner.hasProjectSnapshot
                ? " · showing all projects"
                : " · cached membership")}
        </p>
      ) : null}
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        {editor ? (
          <SpaceEditor
            key={encodeDockSpaceSelection(
              editor.spaceId === null
                ? { kind: "void", environmentId: editor.environmentId }
                : { kind: "space", environmentId: editor.environmentId, spaceId: editor.spaceId },
            )}
            owner={environments.find((item) => item.environmentId === editor.environmentId) ?? null}
            spaceId={editor.spaceId}
            onClose={() => setEditor(null)}
            onCreated={(spaceId) => {
              select({ kind: "space", environmentId: editor.environmentId, spaceId });
              setEditor(null);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function SpaceEditor({
  owner,
  spaceId,
  onClose,
  onCreated,
}: {
  owner: DockSpaceEnvironmentState | null;
  spaceId: SpaceId | null;
  onClose: () => void;
  onCreated: (id: SpaceId) => void;
}) {
  const space = owner?.snapshot?.spaces.find((item) => item.id === spaceId);
  const [name, setName] = useState(space?.name ?? "");
  const [icon, setIcon] = useState<typeof SpaceIcon.Type>(space?.icon ?? "bag");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const projects = useProjects().filter(
    (project) => project.environmentId === owner?.environmentId,
  );
  const canOperate = useAtomValue(
    serverEnvironment.dispatchSpaceCommand.permissionAtom(owner?.environmentId ?? null),
  );
  const dispatch = useAtomCommand(serverEnvironment.dispatchSpaceCommand, {
    label: "Space change",
  });
  const unavailable =
    !canOperate || owner?.status !== "ready" || (spaceId !== null && space === undefined);
  const assignments = new Map(
    owner?.snapshot?.projectAssignments.map((item) => [item.projectId, item.spaceId]),
  );
  const orderedIds = owner?.snapshot?.spaces.map((item) => item.id) ?? [];
  const index = orderedIds.findIndex((id) => id === spaceId);
  const act = async (input: SpaceCommand, success?: () => void | Promise<void>) => {
    if (busy || unavailable || owner === null) return;
    setBusy(true);
    setError(null);
    const result = await dispatch({ environmentId: owner.environmentId, input });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else await success?.();
    setBusy(false);
  };
  const save = () => {
    if (spaceId === null) {
      const id = SpaceId.make(randomUUID());
      void act(
        {
          type: "space.create",
          commandId: CommandId.make(randomUUID()),
          spaceId: id,
          name: name.trim(),
          icon,
        },
        async () => {
          if (owner === null) return;
          const visible = await waitForAtomValue({
            registry: appAtomRegistry,
            atom: dockSpaceEnvironmentAtom(owner.environmentId),
            predicate: (state) => state.snapshot?.spaces.some((item) => item.id === id) === true,
            timeoutMs: 5_000,
          });
          if (visible) onCreated(id);
          else {
            onClose();
            toastManager.add({
              type: "info",
              title: "Hub created",
              description: "Reconnect to this environment to refresh its Hubs.",
            });
          }
        },
      );
    } else {
      void act({
        type: "space.meta.update",
        commandId: CommandId.make(randomUUID()),
        spaceId,
        name: name.trim(),
        icon,
      });
    }
  };
  const reorder = (offset: number) => {
    const target = index + offset;
    if (index < 0 || target < 0 || target >= orderedIds.length) return;
    const reordered = [...orderedIds];
    [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
    void act({
      type: "space.reorder",
      commandId: CommandId.make(randomUUID()),
      orderedSpaceIds: reordered,
    });
  };
  return (
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>{spaceId === null ? "New Hub" : "Manage Hub"}</DialogTitle>
        <DialogDescription>
          {owner?.label ?? "Environment unavailable"}. Each project belongs to one Hub; unassigned
          projects belong to Void.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {unavailable ? (
          <p role="status" className="text-sm text-muted-foreground">
            Changes require a connected environment with permission to manage Hubs and projects.
          </p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="dock-space-name">Name</Label>
          <Input
            id="dock-space-name"
            value={name}
            maxLength={SPACE_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            disabled={busy || unavailable}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dock-space-icon">Icon</Label>
          <Select
            items={SPACE_ICON_OPTIONS}
            value={icon}
            onValueChange={(value) => {
              if (value !== null) setIcon(value);
            }}
            disabled={busy || unavailable}
          >
            <SelectTrigger id="dock-space-icon">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {SpaceIcon.literals.map((value) => (
                <SelectItem key={value} value={value}>
                  <SpaceGlyph icon={value} />
                  {SPACE_ICON_LABELS[value]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        {space ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">Hub order</span>
              <div className="flex gap-1">
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Move Hub earlier"
                  disabled={busy || unavailable || index <= 0}
                  onClick={() => reorder(-1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Move Hub later"
                  disabled={busy || unavailable || index === orderedIds.length - 1}
                  onClick={() => reorder(1)}
                >
                  <ArrowDownIcon />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dock-space-project-search">Projects in {owner?.label}</Label>
              <p className="text-xs text-muted-foreground">
                Select to move a project here. Clear it to return the project to Void.
              </p>
              <Input
                id="dock-space-project-search"
                placeholder="Filter projects"
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
              />
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {projects
                  .filter((project) =>
                    (project.title + " " + project.workspaceRoot)
                      .toLocaleLowerCase()
                      .includes(projectSearch.toLocaleLowerCase()),
                  )
                  .map((project) => (
                    <label key={project.id} className="flex cursor-pointer items-start gap-2 py-1">
                      <Checkbox
                        aria-label={project.title + " · " + project.workspaceRoot}
                        checked={assignments.get(project.id) === space.id}
                        disabled={busy || unavailable}
                        onCheckedChange={(checked) => {
                          void act({
                            type: "space.projects.assign",
                            commandId: CommandId.make(randomUUID()),
                            spaceId: checked ? space.id : null,
                            projectIds: [project.id],
                          });
                        }}
                      />
                      <span className="min-w-0 text-sm">
                        <span className="block truncate">{project.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {project.workspaceRoot}
                        </span>
                      </span>
                    </label>
                  ))}
                {projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Add a project in this environment to place it in the Hub.
                  </p>
                ) : null}
              </div>
            </div>
            {confirmDelete ? (
              <div className="space-y-2" role="alert">
                <p className="text-sm">
                  Delete Hub {space.name}? Its projects return to Void. Projects and threads are
                  preserved.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy || unavailable}
                    onClick={() => {
                      void act(
                        {
                          type: "space.delete",
                          commandId: CommandId.make(randomUUID()),
                          spaceId: space.id,
                        },
                        onClose,
                      );
                    }}
                  >
                    Delete Hub
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
                    Keep Hub
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="destructive-outline"
                size="sm"
                disabled={busy || unavailable}
                onClick={() => setConfirmDelete(true)}
              >
                Delete Hub
              </Button>
            )}
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button
          disabled={
            busy ||
            unavailable ||
            !name.trim() ||
            (space !== undefined && name.trim() === space.name && icon === space.icon)
          }
          onClick={save}
        >
          {busy ? "Saving…" : spaceId === null ? "Create Hub" : "Save changes"}
        </Button>
      </DialogFooter>
    </DialogPopup>
  );
}
