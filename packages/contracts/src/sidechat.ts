// Adapted from Synara revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { GitHubIssueHost, GitHubIssueRepository } from "./githubIssues.ts";
import { ModelSelection } from "./modelSelection.ts";
import { GitHubIssueContextRecord } from "./composerContext.ts";

export const SidechatOpenInput = Schema.Struct({
  commandId: CommandId,
  sourceThreadId: ThreadId,
  modelSelection: Schema.optionalKey(ModelSelection),
  creationSource: Schema.optionalKey(Schema.Literals(["web", "mobile"])),
});
export type SidechatOpenInput = typeof SidechatOpenInput.Type;

const hasReviewedSidechatText = (input: { readonly text: string }) => input.text.trim().length > 0;
export const SidechatSendToParentInput = Schema.Struct({
  commandId: CommandId,
  sidechatThreadId: ThreadId,
  text: Schema.String,
  creationSource: Schema.optionalKey(Schema.Literals(["web", "mobile"])),
}).check(Schema.makeFilter(hasReviewedSidechatText));
export type SidechatSendToParentInput = typeof SidechatSendToParentInput.Type;

export const SidechatOpenResult = Schema.Struct({ threadId: ThreadId });
export const SidechatSendToParentResult = Schema.Struct({
  threadId: ThreadId,
  sequence: NonNegativeInt,
});

export class SidechatOperationError extends Schema.TaggedError<SidechatOperationError>()(
  "SidechatOperationError",
  {
    reason: Schema.Literals([
      "invalid-input",
      "not-found",
      "mode-limit",
      "request-conflict",
      "unavailable",
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const SidechatExpiry = Schema.Literals(["1h", "24h", "never"]);
export type SidechatExpiry = typeof SidechatExpiry.Type;

export const SidechatIssueContext = Schema.Struct({
  kind: Schema.Literal("github-issue"),
  sourceEnvironmentId: EnvironmentId,
  projectId: ProjectId,
  host: GitHubIssueHost,
  repository: GitHubIssueRepository,
  number: PositiveInt,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
  updatedAt: IsoDateTime,
});
export type SidechatIssueContext = typeof SidechatIssueContext.Type;

export const SidechatSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("thread"),
    threadId: ThreadId,
    snapshotSequence: NonNegativeInt,
    capturedAt: IsoDateTime,
  }),
  Schema.Struct({
    kind: Schema.Literal("github-issue"),
    context: SidechatIssueContext,
    capturedAt: IsoDateTime,
  }),
]);
export type SidechatSource = typeof SidechatSource.Type;

export const SidechatLaunchSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("thread"),
    threadId: ThreadId,
    snapshotSequence: Schema.optionalKey(NonNegativeInt),
    capturedAt: Schema.optionalKey(IsoDateTime),
  }),
  Schema.Struct({
    kind: Schema.Literal("github-issue"),
    context: SidechatIssueContext,
    capturedAt: Schema.optionalKey(IsoDateTime),
    reference: Schema.optionalKey(GitHubIssueContextRecord),
  }).check(
    Schema.makeFilter(
      (source) =>
        source.reference === undefined ||
        (source.reference.environmentId === source.context.sourceEnvironmentId &&
          source.reference.projectId === source.context.projectId &&
          source.reference.host.toLowerCase() === source.context.host.toLowerCase() &&
          source.reference.repository.toLowerCase() === source.context.repository.toLowerCase() &&
          source.reference.number === source.context.number),
    ),
  ),
]);
export type SidechatLaunchSource = typeof SidechatLaunchSource.Type;

export const SidechatThreadFields = {
  sidechatSourceThreadId: Schema.optionalKey(Schema.NullOr(ThreadId)),
  sidechatContext: Schema.optionalKey(Schema.NullOr(SidechatIssueContext)),
  sidechatCapturedAt: Schema.optionalKey(IsoDateTime),
  sidechatSnapshotSequence: Schema.optionalKey(NonNegativeInt),
  sidechatLastActivityAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  sidechatExpiredAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
} as const;
