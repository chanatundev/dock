import { useId, useRef, useState, type FormEvent } from "react";

import {
  TASK_NOTES_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
  type ScopedProjectRef,
  type TaskPriority,
} from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import {
  scopedProjectRefKey,
  validateDockTaskEditorDraft,
  type DockTaskEditorDraft,
  type DockTaskEditorValues,
} from "./dockTaskEditor.logic.ts";

const NO_PROJECT_VALUE = "no-project";
const PRIORITY_OPTIONS: ReadonlyArray<{ value: TaskPriority; label: string }> = [
  { value: "none", label: "No priority" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export interface DockTaskProjectOption {
  project: ScopedProjectRef;
  label: string;
  disabled?: boolean;
}

export interface DockTaskEditorProps {
  initialValues: DockTaskEditorValues;
  projectOptions: readonly DockTaskProjectOption[];
  disabled?: boolean;
  submitLabel: string;
  onSave: (values: DockTaskEditorValues) => Promise<void>;
  onCancel?: () => void;
}

function toDraft(values: DockTaskEditorValues): DockTaskEditorDraft {
  return {
    ...values,
    dueDate: values.dueDate ?? "",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Could not save this Task. Try again.";
}

export function DockTaskEditor({
  initialValues,
  projectOptions,
  disabled = false,
  submitLabel,
  onSave,
  onCancel,
}: DockTaskEditorProps) {
  const id = useId();
  const submittingRef = useRef(false);
  const [draft, setDraft] = useState(() => toDraft(initialValues));
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const validation = validateDockTaskEditorDraft(draft);
  const controlsDisabled = disabled || isSaving;
  const selectedProject = draft.project;
  const selectedProjectOption = selectedProject
    ? projectOptions.find(
        (option) => scopedProjectRefKey(option.project) === scopedProjectRefKey(selectedProject),
      )
    : undefined;
  const selectedProjectValue = selectedProject
    ? scopedProjectRefKey(selectedProject)
    : NO_PROJECT_VALUE;
  const selectedProjectLabel = selectedProject
    ? (selectedProjectOption?.label ?? `Unavailable project (${selectedProject.projectId})`)
    : "No project label";
  const projectUnavailable =
    selectedProject !== null &&
    (selectedProjectOption === undefined || selectedProjectOption.disabled === true);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controlsDisabled || submittingRef.current) return;

    setHasSubmitted(true);
    setSaveError(null);
    if (!validation.values) return;

    submittingRef.current = true;
    setIsSaving(true);
    try {
      await onSave(validation.values);
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      submittingRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <form className="grid gap-4" noValidate onSubmit={handleSubmit}>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-title`}>Title</Label>
        <Input
          id={`${id}-title`}
          autoComplete="off"
          disabled={controlsDisabled}
          maxLength={TASK_TITLE_MAX_LENGTH}
          required
          value={draft.title}
          aria-invalid={hasSubmitted && validation.errors.title !== undefined}
          aria-describedby={
            hasSubmitted && validation.errors.title ? `${id}-title-error` : undefined
          }
          onChange={(event) => {
            const title = event.currentTarget.value;
            setDraft((current) => ({ ...current, title }));
          }}
        />
        {hasSubmitted && validation.errors.title ? (
          <p id={`${id}-title-error`} className="text-destructive text-xs" role="alert">
            {validation.errors.title}
          </p>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-notes`}>Notes</Label>
        <Textarea
          id={`${id}-notes`}
          disabled={controlsDisabled}
          maxLength={TASK_NOTES_MAX_LENGTH}
          value={draft.notes}
          aria-invalid={hasSubmitted && validation.errors.notes !== undefined}
          aria-describedby={
            hasSubmitted && validation.errors.notes ? `${id}-notes-error` : undefined
          }
          onChange={(event) => {
            const notes = event.currentTarget.value;
            setDraft((current) => ({ ...current, notes }));
          }}
        />
        {hasSubmitted && validation.errors.notes ? (
          <p id={`${id}-notes-error`} className="text-destructive text-xs" role="alert">
            {validation.errors.notes}
          </p>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-priority`}>Priority</Label>
        <Select
          items={PRIORITY_OPTIONS}
          value={draft.priority}
          disabled={controlsDisabled}
          onValueChange={(value) => {
            const option = PRIORITY_OPTIONS.find((candidate) => candidate.value === value);
            if (option) setDraft((current) => ({ ...current, priority: option.value }));
          }}
        >
          <SelectTrigger id={`${id}-priority`}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {PRIORITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-due-date`}>Due date</Label>
        <Input
          nativeInput
          id={`${id}-due-date`}
          type="date"
          disabled={controlsDisabled}
          value={draft.dueDate}
          aria-invalid={hasSubmitted && validation.errors.dueDate !== undefined}
          aria-describedby={
            hasSubmitted && validation.errors.dueDate ? `${id}-due-date-error` : undefined
          }
          onChange={(event) => {
            const dueDate = event.currentTarget.value;
            setDraft((current) => ({ ...current, dueDate }));
          }}
        />
        {hasSubmitted && validation.errors.dueDate ? (
          <p id={`${id}-due-date-error`} className="text-destructive text-xs" role="alert">
            {validation.errors.dueDate}
          </p>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-project`}>Project label</Label>
        <Select
          value={selectedProjectValue}
          disabled={controlsDisabled}
          onValueChange={(value) => {
            if (value === NO_PROJECT_VALUE) {
              setDraft((current) => ({ ...current, project: null }));
              return;
            }
            const option = projectOptions.find(
              (candidate) => scopedProjectRefKey(candidate.project) === value,
            );
            if (option && !option.disabled) {
              setDraft((current) => ({ ...current, project: option.project }));
            }
          }}
        >
          <SelectTrigger id={`${id}-project`}>
            <SelectValue>{selectedProjectLabel}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={NO_PROJECT_VALUE}>No project label</SelectItem>
            {draft.project && !selectedProjectOption ? (
              <SelectItem value={selectedProjectValue} disabled>
                {selectedProjectLabel}
              </SelectItem>
            ) : null}
            {projectOptions.map((option) => {
              const value = scopedProjectRefKey(option.project);
              return (
                <SelectItem key={value} value={value} disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              );
            })}
          </SelectPopup>
        </Select>
        <p className="text-muted-foreground text-xs">Execution project is chosen separately.</p>
        {projectUnavailable ? (
          <p className="text-muted-foreground text-xs" role="status">
            Current project label “{selectedProjectLabel}” is unavailable and will be kept unless
            you choose another label.
          </p>
        ) : null}
      </div>

      {saveError ? (
        <p className="text-destructive text-sm" role="alert">
          {saveError}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button disabled={controlsDisabled} variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button disabled={controlsDisabled} type="submit">
          {isSaving ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
