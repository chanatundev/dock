import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ExecutionEnvironmentCapabilities } from "./environment.ts";
import { SpaceCommand } from "./spaces.ts";

const decodeCommand = Schema.decodeUnknownSync(SpaceCommand);
const create = {
  type: "space.create",
  commandId: "create-work",
  spaceId: "work",
  name: "Work",
  icon: "bag",
};

describe("Space commands", () => {
  it("normalizes names and rejects blank, oversized, and unknown icon inputs", () => {
    expect(decodeCommand({ ...create, name: "  Work  " })).toMatchObject({ name: "Work" });
    for (const patch of [{ name: " " }, { name: "a".repeat(33) }, { icon: "unknown" }]) {
      expect(() => decodeCommand({ ...create, ...patch })).toThrow();
    }
  });

  it("accepts explicit unassignment and bounds atomic project batches", () => {
    const assign = {
      type: "space.projects.assign",
      commandId: "unassign",
      spaceId: null,
      projectIds: ["project"],
    };
    expect(decodeCommand(assign)).toMatchObject({ spaceId: null });
    expect(() => decodeCommand({ ...assign, projectIds: [] })).toThrow();
    expect(() =>
      decodeCommand({
        ...assign,
        projectIds: Array.from({ length: 201 }, (_, i) => `project-${i}`),
      }),
    ).toThrow();
    expect(() => decodeCommand({ ...assign, spaceId: undefined })).toThrow();
  });

  it("keeps Space capability optional for independently upgraded environments", () => {
    const decode = Schema.decodeUnknownSync(ExecutionEnvironmentCapabilities);
    expect(decode({ repositoryIdentity: true }).dockSpaces).toBeUndefined();
    expect(decode({ repositoryIdentity: true, dockSpaces: true }).dockSpaces).toBe(true);
  });
});
