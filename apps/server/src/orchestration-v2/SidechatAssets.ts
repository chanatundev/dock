import {
  ChatAttachmentId,
  type ChatAttachment,
  type OrchestrationV2SidechatSnapshot,
  type SidechatSnapshotAsset,
  ThreadId,
} from "@t3tools/contracts";
import { htmlRenderFromToolItem, mcpAppFromToolItem } from "@t3tools/shared/toolOutput";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  createAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";

export class SidechatAssetError extends Schema.TaggedError<SidechatAssetError>()(
  "SidechatAssetError",
  { threadId: ThreadId, message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

function references(snapshot: OrchestrationV2SidechatSnapshot) {
  const uploads = new Map<string, ChatAttachment>();
  const generated = new Map<string, string>();
  for (const item of snapshot.items) {
    if (item.type === "user_message" || item.type === "assistant_message") {
      for (const attachment of item.attachments ?? []) uploads.set(attachment.id, attachment);
    } else if (item.type === "user_input_request") {
      for (const attachments of Object.values(item.questionAnswer?.attachmentsByQuestionId ?? {}))
        for (const attachment of attachments) uploads.set(attachment.id, attachment);
    } else if (item.type === "dynamic_tool") {
      const page = htmlRenderFromToolItem(item);
      const app = mcpAppFromToolItem(item);
      if (page !== undefined) generated.set(page.attachmentId, `${page.title}.html`);
      if (app !== undefined) generated.set(app.attachmentId, `${app.tool}.html`);
    }
  }
  return { uploads, generated };
}

interface StagedSnapshot {
  readonly snapshot: OrchestrationV2SidechatSnapshot;
  readonly copiedPaths: ReadonlyArray<string>;
}

export class SidechatAssets extends Context.Reference<{
  readonly stage: (input: {
    readonly threadId: ThreadId;
    readonly snapshot: OrchestrationV2SidechatSnapshot;
  }) => Effect.Effect<StagedSnapshot, SidechatAssetError>;
  readonly release: (paths: ReadonlyArray<string>) => Effect.Effect<void>;
  readonly path: (attachmentId: string) => Effect.Effect<string | null>;
}>("t3/orchestration-v2/SidechatAssets", {
  defaultValue: () => ({
    stage: ({ threadId, snapshot }) => {
      const refs = references(snapshot);
      return refs.uploads.size === 0 && refs.generated.size === 0
        ? Effect.succeed({ snapshot, copiedPaths: [] })
        : Effect.fail(
            new SidechatAssetError({
              threadId,
              message: "Side-chat asset storage is unavailable.",
            }),
          );
    },
    release: () => Effect.void,
    path: () => Effect.succeed(null),
  }),
}) {}

export const layer = Layer.effect(
  SidechatAssets,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const release = Effect.fn("SidechatAssets.release")(function* (paths: ReadonlyArray<string>) {
      yield* Effect.forEach(paths, (file) => fs.remove(file, { force: true }).pipe(Effect.ignore), {
        concurrency: 1,
        discard: true,
      });
    });
    const stage = Effect.fn("SidechatAssets.stage")(function* ({
      threadId,
      snapshot,
    }: {
      readonly threadId: ThreadId;
      readonly snapshot: OrchestrationV2SidechatSnapshot;
    }) {
      const refs = references(snapshot);
      const copiedPaths: string[] = [];
      const owned: SidechatSnapshotAsset[] = [];
      const ids = new Set([...refs.uploads.keys(), ...refs.generated.keys()]);
      yield* Effect.forEach(
        ids,
        (sourceId) =>
          Effect.gen(function* () {
            const original = refs.uploads.get(sourceId);
            const sourcePath =
              original === undefined
                ? resolveAttachmentPathById({
                    attachmentsDir: config.attachmentsDir,
                    attachmentId: sourceId,
                  })
                : resolveAttachmentPath({
                    attachmentsDir: config.attachmentsDir,
                    attachment: original,
                  });
            const info =
              sourcePath === null
                ? null
                : yield* fs.stat(sourcePath).pipe(
                    Effect.catchTags({
                      PlatformError: (error) =>
                        error.reason._tag === "NotFound"
                          ? Effect.succeed(null)
                          : Effect.fail(error),
                    }),
                  );
            if (info === null || sourcePath === null) {
              owned.push({
                sourceAttachmentId: ChatAttachmentId.make(sourceId),
                name: original?.name ?? refs.generated.get(sourceId)!,
                attachment: null,
              });
              return;
            }
            if (
              info.type !== "File" ||
              (original !== undefined && Number(info.size) !== original.sizeBytes)
            )
              return yield* new SidechatAssetError({
                threadId,
                message: `Frozen attachment ${sourceId} no longer matches its recorded file.`,
              });
            const extension = path.extname(sourcePath).slice(1);
            const id = createAttachmentId(threadId, extension);
            if (id === null)
              return yield* new SidechatAssetError({
                threadId,
                message: "Cannot allocate a snapshot attachment.",
              });
            const destination = path.join(config.attachmentsDir, `${id}.${extension}`);
            // Like upload claims, staging is a copy. Register rollback before cancellation can land.
            yield* Effect.sync(() => copiedPaths.push(destination)).pipe(
              Effect.andThen(fs.copyFile(sourcePath, destination)),
              Effect.uninterruptible,
            );
            owned.push({
              sourceAttachmentId: ChatAttachmentId.make(sourceId),
              attachment:
                original === undefined
                  ? {
                      type: "file",
                      id: ChatAttachmentId.make(id),
                      name: refs.generated.get(sourceId)!,
                      mimeType: "text/html",
                      sizeBytes: Number(info.size),
                    }
                  : { ...original, id: ChatAttachmentId.make(id) },
            });
          }),
        { concurrency: 1, discard: true },
      ).pipe(
        Effect.onError(() => release(copiedPaths)),
        Effect.mapError((cause) =>
          cause._tag === "SidechatAssetError"
            ? cause
            : new SidechatAssetError({
                threadId,
                message: "Could not copy frozen side-chat assets.",
                cause,
              }),
        ),
      );
      return { snapshot: { ...snapshot, assets: owned }, copiedPaths } satisfies StagedSnapshot;
    });
    return {
      stage,
      release,
      path: (attachmentId) =>
        Effect.sync(() =>
          resolveAttachmentPathById({ attachmentsDir: config.attachmentsDir, attachmentId }),
        ),
    };
  }),
);
