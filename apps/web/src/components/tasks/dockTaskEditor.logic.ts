import * as Schema from "effect/Schema";

import {
  TASK_NOTES_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
  TaskDueDate,
  TaskNotes,
  TaskTitle,
  type DockTask,
  type ScopedProjectRef,
} from "@t3tools/contracts";

const isTaskTitle = Schema.is(TaskTitle);
const isTaskNotes = Schema.is(TaskNotes);
const isTaskDueDate = Schema.is(TaskDueDate);

export type DockTaskEditorValues = Pick<
  DockTask,
  "title" | "notes" | "priority" | "dueDate" | "project"
>;

export interface DockTaskEditorDraft {
  title: string;
  notes: string;
  priority: DockTaskEditorValues["priority"];
  dueDate: string;
  project: ScopedProjectRef | null;
}

export interface DockTaskEditorErrors {
  title?: string;
  notes?: string;
  dueDate?: string;
}

export function scopedProjectRefKey(project: ScopedProjectRef): string {
  return JSON.stringify([project.environmentId, project.projectId]);
}

export function validateDockTaskEditorDraft(draft: DockTaskEditorDraft): {
  errors: DockTaskEditorErrors;
  values: DockTaskEditorValues | null;
} {
  const title = draft.title.trim();
  const titleEmpty = title.length === 0;
  const errors: DockTaskEditorErrors = {};

  if (!isTaskTitle(title)) {
    errors.title = titleEmpty
      ? "Title is required."
      : `Title must be ${TASK_TITLE_MAX_LENGTH} characters or fewer.`;
  }
  if (!isTaskNotes(draft.notes)) {
    errors.notes = `Notes must be ${TASK_NOTES_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`;
  }

  let dueDate: DockTaskEditorValues["dueDate"] = null;
  if (draft.dueDate !== "") {
    if (isTaskDueDate(draft.dueDate)) {
      dueDate = draft.dueDate;
    } else {
      errors.dueDate = "Enter a valid calendar date.";
    }
  }

  return {
    errors,
    values:
      Object.keys(errors).length === 0
        ? {
            title,
            notes: draft.notes,
            priority: draft.priority,
            dueDate,
            project: draft.project,
          }
        : null,
  };
}
