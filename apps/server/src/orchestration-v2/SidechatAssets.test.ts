import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  OrchestrationV2SidechatSnapshotJson,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { createAttachmentId, resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as SidechatAssets from "./SidechatAssets.ts";

const layer = SidechatAssets.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "dock-side-assets-" })),
  Layer.provideMerge(NodeServices.layer),
);
const sideId = ThreadId.make("side-owned-assets");
const decodeSnapshot = Schema.decodeUnknownEffect(OrchestrationV2SidechatSnapshotJson);

const fixture = Effect.fn("test.sidechatAssetFixture")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
  const id = ChatAttachmentId.make(createAttachmentId("parent", "txt")!);
  const file = path.join(config.attachmentsDir, `${id}.txt`);
  yield* fs.writeFileString(file, "Original frozen bytes");
  const attachment = {
    type: "file" as const,
    id,
    name: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 21,
  };
  const base = {
    threadId: "parent",
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed",
    title: null,
    startedAt: "2026-10-26T12:00:00.000Z",
    completedAt: "2026-10-26T12:00:00.000Z",
    updatedAt: "2026-10-26T12:00:00.000Z",
  };
  const snapshot = yield* decodeSnapshot({
    source: { kind: "thread", threadId: "parent", snapshotSequence: 1, capturedAt: base.updatedAt },
    referenceText: "",
    items: [
      {
        ...base,
        id: "question",
        type: "user_message",
        messageId: "message",
        createdBy: "user",
        creationSource: "web",
        text: "Read",
        attachments: [attachment],
        inputIntent: "turn_start",
      },
      {
        ...base,
        id: "answer",
        type: "assistant_message",
        messageId: "reply",
        text: "Result",
        streaming: false,
        attachments: [attachment],
      },
    ],
  });
  return { snapshot, id, file };
});

it.effect("copies each referenced upload once and survives parent deletion and edits", () =>
  Effect.gen(function* () {
    const { snapshot, id, file } = yield* fixture();
    const assets = yield* SidechatAssets.SidechatAssets;
    const fs = yield* FileSystem.FileSystem;
    const staged = yield* assets.stage({ threadId: sideId, snapshot });
    assert.lengthOf(staged.snapshot.assets ?? [], 1);
    const owned = staged.snapshot.assets![0]!;
    assert.equal(owned.sourceAttachmentId, id);
    assert.notEqual(owned.attachment!.id, id);
    const copied = yield* assets.path(owned.attachment!.id);
    assert.isNotNull(copied);
    yield* fs.writeFileString(file, "Edited parent bytes");
    yield* fs.remove(file);
    assert.equal(yield* fs.readFileString(copied!), "Original frozen bytes");
    assert.deepEqual(staged.snapshot.items, snapshot.items);
    yield* assets.release(staged.copiedPaths);
    assert.isFalse(yield* fs.exists(copied!));
  }).pipe(Effect.provide(layer)),
);

it.effect("copies generated HTML with a scoped attachment ID", () =>
  Effect.gen(function* () {
    const { snapshot } = yield* fixture();
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const id = createAttachmentId("parent", "html")!;
    yield* fs.writeFileString(path.join(config.attachmentsDir, `${id}.html`), "<p>Frozen page</p>");
    const item = snapshot.items[0]!;
    if (item.type !== "user_message") return;
    const generated = {
      ...item,
      type: "dynamic_tool" as const,
      toolName: "mcp__t3-code__html_render",
      input: {},
      output: { htmlRender: { attachmentId: id, title: "Page", height: 200 } },
    };
    const assets = yield* SidechatAssets.SidechatAssets;
    const staged = yield* assets.stage({
      threadId: sideId,
      snapshot: { ...snapshot, items: [generated] },
    });
    const owned = staged.snapshot.assets![0]!;
    assert.equal(owned.attachment!.mimeType, "text/html");
    const copied = yield* assets.path(owned.attachment!.id);
    assert.equal(yield* fs.readFileString(copied!), "<p>Frozen page</p>");
    assert.include(owned.attachment!.id, "side-owned-assets-");
    assert.isNotNull(
      resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: owned.attachment!.id,
      }),
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("preserves frozen text and available copies when an older attachment is missing", () =>
  Effect.gen(function* () {
    const { snapshot, id } = yield* fixture();
    const assets = yield* SidechatAssets.SidechatAssets;
    const fs = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    const item = snapshot.items[0]!;
    assert.equal(item.type, "user_message");
    if (item.type !== "user_message") return;
    const missing = {
      ...item.attachments[0]!,
      id: ChatAttachmentId.make(createAttachmentId("missing", "txt")!),
    };
    const staged = yield* assets.stage({
      threadId: sideId,
      snapshot: {
        ...snapshot,
        items: [{ ...item, attachments: [...item.attachments, missing] }],
      },
    });
    assert.equal(staged.snapshot.items[0]?.type, "user_message");
    assert.deepEqual(staged.snapshot.assets?.[1], {
      sourceAttachmentId: missing.id,
      name: "notes.txt",
      attachment: null,
    });
    assert.equal(staged.copiedPaths.length, 1);
    assert.equal(yield* fs.readFileString(staged.copiedPaths[0]!), "Original frozen bytes");
    assert.deepEqual(staged.snapshot.items, [
      { ...item, attachments: [...item.attachments, missing] },
    ]);
    yield* assets.release(staged.copiedPaths);
    assert.deepEqual(yield* fs.readDirectory(config.attachmentsDir), [`${id}.txt`]);
  }).pipe(Effect.provide(layer)),
);

it.effect("rejects changed source bytes and rolls back copies already staged", () =>
  Effect.gen(function* () {
    const { snapshot, id } = yield* fixture();
    const assets = yield* SidechatAssets.SidechatAssets;
    const fs = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const item = snapshot.items[0]!;
    if (item.type !== "user_message") return;
    const changed = {
      ...item.attachments[0]!,
      id: ChatAttachmentId.make(createAttachmentId("changed", "txt")!),
    };
    yield* fs.writeFileString(path.join(config.attachmentsDir, `${changed.id}.txt`), "Changed");
    const result = yield* Effect.exit(
      assets.stage({
        threadId: sideId,
        snapshot: {
          ...snapshot,
          items: [{ ...item, attachments: [...item.attachments, changed] }],
        },
      }),
    );
    assert.equal(result._tag, "Failure");
    assert.deepEqual(
      (yield* fs.readDirectory(config.attachmentsDir)).sort(),
      [`${id}.txt`, `${changed.id}.txt`].sort(),
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("removes a partial destination left by a failed copy operation", () =>
  Effect.gen(function* () {
    const { snapshot, id } = yield* fixture();
    const fs = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    const failing = Layer.fresh(
      SidechatAssets.layer.pipe(
        Layer.provide(
          Layer.succeed(FileSystem.FileSystem, {
            ...fs,
            copyFile: (_from, to) =>
              fs
                .writeFileString(to, "partial")
                .pipe(Effect.andThen(fs.copyFile(`${to}.missing`, to))),
          }),
        ),
      ),
    );
    const result = yield* Effect.exit(
      SidechatAssets.SidechatAssets.pipe(
        Effect.flatMap((assets) => assets.stage({ threadId: sideId, snapshot })),
        Effect.provide(failing),
      ),
    );
    assert.equal(result._tag, "Failure");
    assert.deepEqual(yield* fs.readDirectory(config.attachmentsDir), [`${id}.txt`]);
  }).pipe(Effect.provide(layer)),
);
