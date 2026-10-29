import * as Schema from "effect/Schema";

import { NonNegativeInt, ThreadId } from "./baseSchemas.ts";
import { SidechatSource } from "./sidechat.ts";
import { SidechatSnapshotAsset } from "./orchestrationV2.ts";
import { GitHubIssueContextRecord } from "./composerContext.ts";

const SidechatReadContextOffset = NonNegativeInt.annotate({
  description: "UTF-16 code-unit offset into the JSON-serialized frozen snapshot text.",
});

const SidechatReadContextLimit = Schema.Int.check(
  Schema.isBetween({ minimum: 2, maximum: 16_000 }),
);
const SidechatAssetPageLimit = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 }));

export const SidechatReadContextInput = Schema.Struct({
  threadId: ThreadId,
  offset: Schema.optionalKey(SidechatReadContextOffset),
  limit: Schema.optionalKey(SidechatReadContextLimit),
  assetOffset: Schema.optionalKey(NonNegativeInt),
  assetLimit: Schema.optionalKey(SidechatAssetPageLimit).annotate({
    description: "Asset metadata page size, default 20, at most 50. Set 0 when paging only text.",
  }),
});
export type SidechatReadContextInput = typeof SidechatReadContextInput.Type;

export const SidechatReadContextResult = Schema.Struct({
  source: SidechatSource,
  totalItems: NonNegativeInt,
  totalChars: NonNegativeInt,
  offset: NonNegativeInt,
  text: Schema.String,
  nextOffset: Schema.NullOr(NonNegativeInt),
  issueContext: Schema.optionalKey(GitHubIssueContextRecord).annotate({
    description: "The bounded immutable opening issue card, returned on the first text page only.",
  }),
  assets: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        ...SidechatSnapshotAsset.fields,
        path: Schema.NullOr(Schema.String),
      }),
    ).check(Schema.isMaxLength(50)),
  ),
  totalAssets: Schema.optionalKey(NonNegativeInt),
  nextAssetOffset: Schema.optionalKey(Schema.NullOr(NonNegativeInt)),
});
export type SidechatReadContextResult = typeof SidechatReadContextResult.Type;

export class SidechatContextError extends Schema.TaggedError<SidechatContextError>()(
  "SidechatContextError",
  {
    threadId: ThreadId,
    reason: Schema.Literals(["invalid-input", "not-found", "unavailable"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "invalid-input":
        return `Invalid side-chat context request for thread ${this.threadId}.`;
      case "not-found":
        return `No frozen side-chat context exists for thread ${this.threadId}.`;
      case "unavailable":
        return `Frozen side-chat context for thread ${this.threadId} could not be read.`;
    }
  }
}
