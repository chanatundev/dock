// Issue and repository-context vocabulary adapted from Synara revision 3f55b77ef186764050ecf4edd6ae0879eec948a8.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import * as Schema from "effect/Schema";
import { PositiveInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const GitHubIssueHost = TrimmedNonEmptyString.check(
  Schema.isMaxLength(253),
  Schema.isPattern(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/i),
);
export const GitHubIssueRepository = TrimmedNonEmptyString.check(
  Schema.isMaxLength(300),
  Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/[a-z0-9_.-]+$/i),
  Schema.makeFilter((value) => ![".", ".."].includes(value.split("/")[1] ?? "")),
);
export const GitHubIssueState = Schema.Literals(["open", "closed"]);
export type GitHubIssueState = typeof GitHubIssueState.Type;
export const GitHubIssueRef = Schema.Struct({
  projectId: ProjectId,
  host: GitHubIssueHost,
  repository: GitHubIssueRepository,
  number: PositiveInt,
});
export type GitHubIssueRef = typeof GitHubIssueRef.Type;
