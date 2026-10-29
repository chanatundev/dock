import { assert, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  OrchestrationV2SidechatSnapshotJson,
  ComposerContextId,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as SidechatContextService from "./SidechatContextService.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as SidechatAssets from "./SidechatAssets.ts";
import type { SidechatReadContextResult } from "@t3tools/contracts";
import type { OrchestrationV2SidechatSnapshot } from "@t3tools/contracts";

const sideThreadId = ThreadId.make("side-thread");
const encodeSnapshot = Schema.encodeSync(
  Schema.fromJsonString(OrchestrationV2SidechatSnapshotJson),
);

const snapshot = Schema.decodeSync(OrchestrationV2SidechatSnapshotJson)({
  source: {
    kind: "thread",
    threadId: "parent-thread",
    snapshotSequence: 42,
    capturedAt: "2026-10-26T12:00:00.000Z",
  },
  items: [
    {
      id: "turn-item:partial",
      threadId: "parent-thread",
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 3,
      status: "running",
      title: null,
      startedAt: "2026-10-26T11:59:00.000Z",
      completedAt: null,
      updatedAt: "2026-10-26T12:00:00.000Z",
      type: "assistant_message",
      messageId: "message:partial",
      text: "Partial frozen reply 🧪 with emoji boundaries.",
      streaming: true,
    },
  ],
  referenceText: "Frozen reference with 🧪 context.",
});

function serviceLayer(value: OrchestrationV2SidechatSnapshot | null) {
  return SidechatContextService.layer.pipe(
    Layer.provide(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getSidechatSnapshot: () => Effect.succeed(value),
      }),
    ),
  );
}

function jsonText(value: OrchestrationV2SidechatSnapshot): string {
  return encodeSnapshot(value);
}

function hasUnpairedSurrogate(value: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}

it.effect("returns the immutable opening issue card on the first page only", () => {
  const issueContext = {
    version: 1 as const,
    kind: "github-issue" as const,
    contextId: ComposerContextId.make("opening-issue"),
    label: "Issue 42",
    environmentId: EnvironmentId.make("issue-owner"),
    projectId: ProjectId.make("issue-project"),
    host: "github.com",
    repository: "acme/repo",
    number: 42,
    url: "https://github.com/acme/repo/issues/42",
    title: "Original issue",
    state: "open" as const,
    capturedAt: "2026-10-27T12:00:00.000Z",
    sourceUpdatedAt: "2026-10-26T12:00:00.000Z",
    body: "Opening description",
    bodyTruncated: false,
    comments: [],
    totalComments: 0,
    omittedComments: 0,
  };
  return Effect.gen(function* () {
    const service = yield* SidechatContextService.SidechatContextService;
    const first = yield* service.read({ threadId: sideThreadId, limit: 2, assetLimit: 0 });
    assert.deepEqual(first.issueContext, issueContext);
    const next = yield* service.read({
      threadId: sideThreadId,
      limit: 2,
      offset: first.nextOffset!,
    });
    assert.isUndefined(next.issueContext);
  }).pipe(Effect.provide(serviceLayer({ ...snapshot, issueContext })));
});

it.effect("reports a missing frozen snapshot as a typed not-found error", () =>
  Effect.gen(function* () {
    const service = yield* SidechatContextService.SidechatContextService;
    const error = yield* service.read({ threadId: sideThreadId }).pipe(Effect.flip);

    assert.equal(error._tag, "SidechatContextError");
    assert.equal(error.reason, "not-found");
    assert.equal(error.threadId, sideThreadId);
  }).pipe(Effect.provide(serviceLayer(null))),
);

it.effect("returns snapshot-owned asset paths on demand without consulting the parent", () =>
  Effect.gen(function* () {
    const service = yield* SidechatContextService.SidechatContextService;
    const result = yield* service.read({ threadId: sideThreadId, limit: 100 });
    assert.equal(result.assets?.[0]?.path, "/isolated/attachments/side-owned.txt");
    assert.equal(result.assets?.[0]?.attachment?.id, "side-owned");
    assert.equal(result.assets?.[0]?.sourceAttachmentId, "parent-file");
    assert.isNotNull(result.nextOffset);
  }).pipe(
    Effect.provide(
      serviceLayer({
        ...snapshot,
        assets: [
          {
            sourceAttachmentId: ChatAttachmentId.make("parent-file"),
            attachment: {
              type: "file",
              id: ChatAttachmentId.make("side-owned"),
              name: "notes.txt",
              mimeType: "text/plain",
              sizeBytes: 6,
            },
          },
        ],
      }).pipe(
        Layer.provide(
          Layer.succeed(SidechatAssets.SidechatAssets, {
            ...SidechatAssets.SidechatAssets.defaultValue(),
            path: () => Effect.succeed("/isolated/attachments/side-owned.txt"),
          }),
        ),
      ),
    ),
  ),
);

it.effect("keeps unavailable assets visible without resolving a parent attachment path", () => {
  let pathReads = 0;
  return Effect.gen(function* () {
    const service = yield* SidechatContextService.SidechatContextService;
    const result = yield* service.read({ threadId: sideThreadId, limit: 2 });
    assert.deepEqual(result.assets, [
      { sourceAttachmentId: "missing", name: "Old notes.txt", attachment: null, path: null },
    ]);
    assert.equal(pathReads, 0);
  }).pipe(
    Effect.provide(
      serviceLayer({
        ...snapshot,
        assets: [
          {
            sourceAttachmentId: ChatAttachmentId.make("missing"),
            name: "Old notes.txt",
            attachment: null,
          },
        ],
      }).pipe(
        Layer.provide(
          Layer.succeed(SidechatAssets.SidechatAssets, {
            ...SidechatAssets.SidechatAssets.defaultValue(),
            path: () =>
              Effect.sync(() => {
                pathReads++;
                return "/wrong-parent-path";
              }),
          }),
        ),
      ),
    ),
  );
});

it.effect("bounds asset metadata and path lookups independently from the text page", () => {
  let pathReads = 0;
  const assets = Array.from({ length: 100 }, (_, index) => ({
    sourceAttachmentId: ChatAttachmentId.make(`source-${index}`),
    attachment: {
      type: "file" as const,
      id: ChatAttachmentId.make(`owned-${index}`),
      name: `${index}.txt`,
      mimeType: "text/plain",
      sizeBytes: 1,
    },
  }));
  return Effect.gen(function* () {
    const service = yield* SidechatContextService.SidechatContextService;
    const result = yield* service.read({
      threadId: sideThreadId,
      limit: 2,
      assetOffset: 3,
      assetLimit: 2,
    });
    assert.lengthOf(result.assets ?? [], 2);
    assert.equal(result.totalAssets, 100);
    assert.equal(result.nextAssetOffset, 5);
    assert.deepEqual(
      result.assets?.map((asset) => asset.attachment?.id),
      ["owned-3", "owned-4"],
    );
    assert.equal(pathReads, 2);
  }).pipe(
    Effect.provide(
      serviceLayer({ ...snapshot, assets }).pipe(
        Layer.provide(
          Layer.succeed(SidechatAssets.SidechatAssets, {
            ...SidechatAssets.SidechatAssets.defaultValue(),
            path: () =>
              Effect.sync(() => {
                pathReads++;
                return "/owned.txt";
              }),
          }),
        ),
      ),
    ),
  );
});

it.effect("rejects runtime-invalid page limits as invalid input", () =>
  Effect.gen(function* () {
    const service = yield* SidechatContextService.SidechatContextService;
    const error = yield* service
      .read({ threadId: sideThreadId, limit: 1 } as never)
      .pipe(Effect.flip);

    assert.equal(error.reason, "invalid-input");
  }).pipe(Effect.provide(serviceLayer(snapshot))),
);

it.effect("maps projection read failures to unavailable", () =>
  Effect.gen(function* () {
    const service = yield* SidechatContextService.SidechatContextService;
    const error = yield* service.read({ threadId: sideThreadId }).pipe(Effect.flip);

    assert.equal(error.reason, "unavailable");
    assert.equal(error.threadId, sideThreadId);
    assert.instanceOf(error.cause, Error);
  }).pipe(
    Effect.provide(
      SidechatContextService.layer.pipe(
        Layer.provide(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getSidechatSnapshot: () =>
              Effect.fail(
                new ProjectionStore.ProjectionStoreReadError({
                  threadId: sideThreadId,
                  cause: new Error("snapshot storage unavailable"),
                }),
              ),
          }),
        ),
      ),
    ),
  ),
);

it.effect("returns bounded pages that reconstruct frozen JSON without splitting emoji", () =>
  Effect.gen(function* () {
    const service = yield* SidechatContextService.SidechatContextService;
    const expected = jsonText(snapshot);
    const pages: Array<string> = [];
    let offset: number | null = 0;

    while (offset !== null) {
      const page: SidechatReadContextResult = yield* service.read({
        threadId: sideThreadId,
        offset,
        limit: 11,
      });
      assert.equal(page.totalItems, 1);
      assert.equal(page.totalChars, expected.length);
      assert.isAtMost(page.text.length, 11);
      assert.isFalse(hasUnpairedSurrogate(page.text));
      pages.push(page.text);
      if (page.nextOffset !== null) assert.isAbove(page.nextOffset, offset);
      offset = page.nextOffset;
    }

    assert.equal(pages.join(""), expected);
    assert.include(expected, "🧪");
  }).pipe(Effect.provide(serviceLayer(snapshot))),
);

it.effect("handles first, last, and out-of-range cursors and keeps active partial items", () =>
  Effect.gen(function* () {
    const service = yield* SidechatContextService.SidechatContextService;
    const expected = jsonText(snapshot);
    const first = yield* service.read({ threadId: sideThreadId, offset: 0, limit: 2 });
    const last = yield* service.read({
      threadId: sideThreadId,
      offset: expected.length - 1,
      limit: 2,
    });
    const beyond = yield* service.read({
      threadId: sideThreadId,
      offset: expected.length + 10,
      limit: 2,
    });
    const splitEmoji = expected.indexOf("🧪") + 1;
    const fromSplitEmoji = yield* service.read({
      threadId: sideThreadId,
      offset: splitEmoji,
      limit: 2,
    });
    const full = yield* service.read({ threadId: sideThreadId, limit: 16_000 });
    const reread = yield* service.read({ threadId: sideThreadId, limit: 16_000 });

    assert.equal(first.offset, 0);
    assert.equal(first.text, expected.slice(0, 2));
    assert.equal(first.nextOffset, 2);
    assert.equal(last.text, "}");
    assert.equal(last.nextOffset, null);
    assert.equal(beyond.text, "");
    assert.equal(beyond.offset, expected.length + 10);
    assert.equal(beyond.nextOffset, null);
    assert.equal(fromSplitEmoji.offset, splitEmoji - 1);
    assert.equal(fromSplitEmoji.text, "🧪");
    assert.equal(fromSplitEmoji.nextOffset, splitEmoji + 1);
    assert.equal(full.text, expected);
    assert.deepEqual(full, reread);
    assert.include(full.text, '"status":"running"');
    assert.include(full.text, "Partial frozen reply 🧪");
    assert.include(full.text, '"threadId":"parent-thread"');
  }).pipe(Effect.provide(serviceLayer(snapshot))),
);

it.effect("defaults page size to 8000 UTF-16 code units", () =>
  Effect.gen(function* () {
    const service = yield* SidechatContextService.SidechatContextService;
    const largeSnapshot = { ...snapshot, referenceText: "x".repeat(9_000) };
    const expected = jsonText(largeSnapshot);
    const page = yield* service.read({ threadId: sideThreadId });

    assert.equal(page.totalChars, expected.length);
    assert.equal(page.text.length, 8_000);
    assert.equal(page.nextOffset, 8_000);
  }).pipe(
    Effect.provide(
      SidechatContextService.layer.pipe(
        Layer.provide(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getSidechatSnapshot: () =>
              Effect.succeed({ ...snapshot, referenceText: "x".repeat(9_000) }),
          }),
        ),
      ),
    ),
  ),
);
