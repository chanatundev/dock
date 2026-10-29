import { OrchestrationV2SidechatSnapshotJson } from "@t3tools/contracts";
import {
  SidechatContextError,
  SidechatReadContextInput,
  SidechatReadContextResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectionStore from "./ProjectionStore.ts";
import * as SidechatAssets from "./SidechatAssets.ts";

const DEFAULT_LIMIT = 8_000;
const decodeReadInput = Schema.decodeUnknownOption(SidechatReadContextInput);
const encodeSnapshot = Schema.encodeSync(
  Schema.fromJsonString(OrchestrationV2SidechatSnapshotJson),
);

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

export class SidechatContextService extends Context.Service<
  SidechatContextService,
  {
    readonly read: (
      input: SidechatReadContextInput,
    ) => Effect.Effect<SidechatReadContextResult, SidechatContextError>;
  }
>()("t3/orchestration-v2/SidechatContextService") {}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const assetStore = yield* SidechatAssets.SidechatAssets;

  const read = Effect.fn("SidechatContextService.read")(function* (
    input: SidechatReadContextInput,
  ) {
    const decoded = decodeReadInput(input);
    if (Option.isNone(decoded)) {
      return yield* new SidechatContextError({
        threadId: input.threadId,
        reason: "invalid-input",
      });
    }

    const {
      threadId,
      offset: requestedOffset = 0,
      limit = DEFAULT_LIMIT,
      assetOffset = 0,
      assetLimit = 20,
    } = decoded.value;
    const snapshot = yield* projections.getSidechatSnapshot(threadId).pipe(
      Effect.mapError(
        (error) =>
          new SidechatContextError({
            threadId,
            reason: "unavailable",
            cause: error.cause ?? error,
          }),
      ),
    );
    if (snapshot === null) {
      return yield* new SidechatContextError({ threadId, reason: "not-found" });
    }

    const text = yield* Effect.try({
      try: () => encodeSnapshot(snapshot),
      catch: (cause) => new SidechatContextError({ threadId, reason: "unavailable", cause }),
    });

    let offset = requestedOffset;
    if (
      offset > 0 &&
      offset < text.length &&
      isHighSurrogate(text.charCodeAt(offset - 1)) &&
      isLowSurrogate(text.charCodeAt(offset))
    ) {
      offset -= 1;
    }

    let end = Math.min(offset + limit, text.length);
    if (
      end > offset &&
      end < text.length &&
      isHighSurrogate(text.charCodeAt(end - 1)) &&
      isLowSurrogate(text.charCodeAt(end))
    ) {
      end -= 1;
    }

    const nextOffset = end < text.length ? end : null;
    return {
      source: snapshot.source,
      totalItems: snapshot.items.length,
      totalChars: text.length,
      offset,
      text: text.slice(offset, end),
      nextOffset,
      ...(offset === 0 && snapshot.issueContext !== undefined
        ? { issueContext: snapshot.issueContext }
        : {}),
      ...(snapshot.assets === undefined
        ? {}
        : {
            assets: yield* Effect.forEach(
              snapshot.assets.slice(assetOffset, assetOffset + assetLimit),
              (asset) =>
                asset.attachment === null
                  ? Effect.succeed({ ...asset, path: null })
                  : assetStore
                      .path(asset.attachment.id)
                      .pipe(Effect.map((path) => ({ ...asset, path }))),
            ),
            totalAssets: snapshot.assets.length,
            nextAssetOffset:
              assetLimit > 0 && assetOffset + assetLimit < snapshot.assets.length
                ? assetOffset + assetLimit
                : null,
          }),
    } satisfies SidechatReadContextResult;
  });

  return SidechatContextService.of({ read });
});

export const layer: Layer.Layer<SidechatContextService, never, ProjectionStore.ProjectionStoreV2> =
  Layer.effect(SidechatContextService, make);
