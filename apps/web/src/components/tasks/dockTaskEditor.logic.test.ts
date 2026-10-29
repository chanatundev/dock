import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { EnvironmentId, ProjectId } from "@t3tools/contracts";

import {
  scopedProjectRefKey,
  validateDockTaskEditorDraft,
  type DockTaskEditorDraft,
} from "./dockTaskEditor.logic.ts";

const decodeEnvironmentId = Schema.decodeUnknownSync(EnvironmentId);
const decodeProjectId = Schema.decodeUnknownSync(ProjectId);

const validDraft: DockTaskEditorDraft = {
  title: "  Review Task form  ",
  notes: "Check the calendar date.",
  priority: "medium",
  dueDate: "",
  project: null,
};

describe("Dock Task editor validation", () => {
  it("trims the title and maps an empty due date to null", () => {
    expect(validateDockTaskEditorDraft(validDraft)).toEqual({
      errors: {},
      values: {
        title: "Review Task form",
        notes: "Check the calendar date.",
        priority: "medium",
        dueDate: null,
        project: null,
      },
    });
  });

  it("rejects blank or overlong text and invalid calendar days", () => {
    const result = validateDockTaskEditorDraft({
      ...validDraft,
      title: "  ",
      notes: "n".repeat(10_001),
      dueDate: "2026-02-31",
    });

    expect(result.values).toBeNull();
    expect(result.errors).toMatchObject({
      title: "Title is required.",
      notes: "Notes must be 10,000 characters or fewer.",
      dueDate: "Enter a valid calendar date.",
    });
  });

  it("keeps environment and project IDs as a tuple identity", () => {
    const first = {
      environmentId: decodeEnvironmentId("env:project"),
      projectId: decodeProjectId("one"),
    };
    const second = {
      environmentId: decodeEnvironmentId("env"),
      projectId: decodeProjectId("project:one"),
    };

    expect(scopedProjectRefKey(first)).not.toBe(scopedProjectRefKey(second));
  });
});
