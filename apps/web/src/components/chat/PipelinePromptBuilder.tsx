import { useMemo, useState } from "react";
import { ProviderInstanceId } from "@t3tools/contracts";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type { ModelEsque } from "./providerIconUtils";
import { getTriggerDisplayModelName } from "./providerIconUtils";

const STAGES = [
  { id: "plan", label: "Plan", instruction: "Inspect the task and write an actionable plan." },
  {
    id: "build",
    label: "Build",
    instruction: "Implement the approved plan and report the changes.",
  },
  {
    id: "review",
    label: "Review",
    instruction: "Review the implementation for bugs and missing requirements.",
  },
] as const;

type StageId = (typeof STAGES)[number]["id"];
type StageSelection = { instanceId: ProviderInstanceId; model: string };

function stageDefault(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  models: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>,
  active: StageSelection,
): StageSelection {
  const entry =
    entries.find((candidate) => candidate.instanceId === active.instanceId) ?? entries[0];
  if (!entry) return active;
  const selectedOptions = models.get(entry.instanceId) ?? [];
  return {
    instanceId: entry.instanceId,
    model:
      entry.instanceId === active.instanceId &&
      selectedOptions.some((model) => model.slug === active.model)
        ? active.model
        : (selectedOptions.find((model) => model.isDefault)?.slug ??
          selectedOptions[0]?.slug ??
          active.model),
  };
}

export function buildPipelinePrompt(input: {
  task: string;
  selections: Readonly<Record<StageId, StageSelection>>;
  entries: ReadonlyArray<ProviderInstanceEntry>;
  models: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
}): string {
  const task = input.task.trim() || "Complete the task described by the user.";
  const stages = STAGES.map((stage) => {
    const selection = input.selections[stage.id];
    const entry = input.entries.find((candidate) => candidate.instanceId === selection.instanceId);
    const model = (input.models.get(selection.instanceId) ?? []).find(
      (candidate) => candidate.slug === selection.model,
    );
    const provider = entry ? `${entry.displayName} (${entry.driverKind})` : "the selected provider";
    return `${stage.label} — ${provider}, ${model?.name ?? selection.model}: ${stage.instruction}`;
  });

  return [
    "Run this task as a Plan → Build → Review pipeline. Complete each stage in order and pass the previous stage's concrete output to the next stage.",
    "",
    `Task: ${task}`,
    "",
    ...stages,
    "",
    "Do not claim that a different provider ran a stage. If the selected provider or model is unavailable in this session, say so and continue the pipeline with the available runtime.",
  ].join("\n");
}

export function PipelinePromptBuilder(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: string;
  entries: ReadonlyArray<ProviderInstanceEntry>;
  models: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  activeSelection: StageSelection;
  onLoadPrompt: (prompt: string) => void;
}) {
  const [task, setTask] = useState(props.task);
  const [selections, setSelections] = useState<Record<StageId, StageSelection>>(() => ({
    plan: stageDefault(props.entries, props.models, props.activeSelection),
    build: stageDefault(props.entries, props.models, props.activeSelection),
    review: stageDefault(props.entries, props.models, props.activeSelection),
  }));
  const optionsByInstance = useMemo(
    () =>
      new Map(
        props.entries.map((entry) => [entry.instanceId, props.models.get(entry.instanceId) ?? []]),
      ),
    [props.entries, props.models],
  );

  const updateStage = (stage: StageId, patch: Partial<StageSelection>) => {
    setSelections((current) => {
      const next = { ...current[stage], ...patch };
      if (patch.instanceId) {
        const options = optionsByInstance.get(patch.instanceId) ?? [];
        next.model = options.find((model) => model.isDefault)?.slug ?? options[0]?.slug ?? "";
      }
      return { ...current, [stage]: next };
    });
  };

  const prompt = buildPipelinePrompt({
    task,
    selections,
    entries: props.entries,
    models: props.models,
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Build a pipeline prompt</DialogTitle>
          <DialogDescription>
            Choose an account and model for each stage. The generated prompt will be loaded into the
            composer for you to review and send.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <label className="grid gap-2 text-sm font-medium">
            Task
            <textarea
              className="min-h-24 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="Describe the work for all three stages"
            />
          </label>
          <div className="grid gap-4">
            {STAGES.map((stage) => {
              const selection = selections[stage.id];
              const stageModels = optionsByInstance.get(selection.instanceId) ?? [];
              return (
                <section
                  key={stage.id}
                  className="grid gap-2 rounded-lg border border-border/70 p-3"
                >
                  <div>
                    <h3 className="text-sm font-medium">{stage.label}</h3>
                    <p className="text-xs text-muted-foreground">{stage.instruction}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Select
                      value={selection.instanceId}
                      onValueChange={(value) =>
                        value &&
                        updateStage(stage.id, { instanceId: ProviderInstanceId.make(value) })
                      }
                      items={props.entries.map((entry) => ({
                        value: entry.instanceId,
                        label: `${entry.displayName} · ${entry.driverKind}`,
                      }))}
                    >
                      <SelectTrigger aria-label={`${stage.label} provider`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup alignItemWithTrigger={false}>
                        {props.entries.map((entry) => (
                          <SelectItem key={entry.instanceId} value={entry.instanceId}>
                            {entry.displayName} · {entry.driverKind}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                    <Select
                      value={selection.model}
                      onValueChange={(value) => value && updateStage(stage.id, { model: value })}
                      items={stageModels.map((model) => ({ value: model.slug, label: model.name }))}
                    >
                      <SelectTrigger
                        aria-label={`${stage.label} model`}
                        disabled={stageModels.length === 0}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup alignItemWithTrigger={false}>
                        {stageModels.map((model) => (
                          <SelectItem key={model.slug} value={model.slug}>
                            {getTriggerDisplayModelName(model)}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>
                </section>
              );
            })}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={props.entries.length === 0}
            onClick={() => {
              props.onLoadPrompt(prompt);
              props.onOpenChange(false);
            }}
          >
            Load prompt into composer
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
