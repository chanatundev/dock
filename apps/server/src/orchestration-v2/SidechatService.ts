import {
  MessageId,
  SidechatOpenInput,
  SidechatOperationError,
  SidechatSendToParentInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { DispatchModeLimit, exceededDispatchModeLimit } from "./DispatchModeLimit.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as Receipts from "./CommandReceiptStore.ts";
import * as ThreadLaunch from "./ThreadLaunchService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

type Provenance = ThreadManagement.ThreadManagementProvenance;
const decodeOpen = Schema.decodeUnknownOption(SidechatOpenInput);
const decodeReturn = Schema.decodeUnknownOption(SidechatSendToParentInput);
const unavailable = (cause: unknown) =>
  new SidechatOperationError({
    reason: "unavailable",
    message: "The side-chat operation could not finish. Retry when the environment is available.",
    cause,
  });

export class SidechatService extends Context.Service<
  SidechatService,
  {
    readonly open: (
      input: SidechatOpenInput,
      provenance: Provenance,
    ) => Effect.Effect<{ readonly threadId: ThreadId }, SidechatOperationError>;
    readonly sendToParent: (
      input: SidechatSendToParentInput,
      provenance: Provenance,
    ) => Effect.Effect<
      { readonly threadId: ThreadId; readonly sequence: number },
      SidechatOperationError
    >;
  }
>()("t3/orchestration-v2/SidechatService") {}

export const layer = Layer.effect(
  SidechatService,
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const receipts = yield* Receipts.CommandReceiptStoreV2;
    const launches = yield* ThreadLaunch.ThreadLaunchService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const locks = yield* KeyedLock.make<string>();
    const read = Effect.fn("SidechatService.readThread")(function* (threadId: ThreadId) {
      return yield* projections.getThread(threadId).pipe(
        Effect.mapError((cause) =>
          cause._tag === "ProjectionStoreThreadNotFoundError"
            ? new SidechatOperationError({
                reason: "not-found",
                message: "The source conversation is unavailable.",
              })
            : unavailable(cause),
        ),
      );
    });
    const open = Effect.fn("SidechatService.open")(function* (
      input: SidechatOpenInput,
      provenance: Provenance,
    ) {
      if (Option.isNone(decodeOpen(input)))
        return yield* new SidechatOperationError({
          reason: "invalid-input",
          message: "Invalid side-chat open request.",
        });
      const previous = yield* receipts
        .getByCommandId(input.commandId)
        .pipe(Effect.mapError(unavailable));
      if (Option.isSome(previous)) {
        const receipt = previous.value;
        if (receipt.commandType !== "thread.create" || receipt.status !== "accepted")
          return yield* new SidechatOperationError({
            reason: "request-conflict",
            message: receipt.error ?? "This command was already used for another operation.",
          });
        const child = yield* read(receipt.threadId);
        if (child.sidechatSourceThreadId !== input.sourceThreadId)
          return yield* new SidechatOperationError({
            reason: "request-conflict",
            message: "This command opened a side chat for another source.",
          });
        return { threadId: child.id };
      }
      const source = yield* read(input.sourceThreadId);
      if (source.deletedAt !== null)
        return yield* new SidechatOperationError({
          reason: "not-found",
          message: "A deleted conversation cannot open a new side chat.",
        });
      const limit = yield* DispatchModeLimit;
      const exceeded = limit === undefined ? undefined : exceededDispatchModeLimit(limit, source);
      if (exceeded !== undefined) {
        if (limit?.refused)
          yield* Ref.set(limit.refused, {
            threadId: source.id,
            mode: exceeded,
            runtimeMode: source.runtimeMode,
            interactionMode: source.interactionMode,
          });
        return yield* new SidechatOperationError({
          reason: "mode-limit",
          message: "The source conversation exceeds the issuing agent's permission ceiling.",
        });
      }
      const launched = yield* launches
        .launch({
          commandId: input.commandId,
          projectId: source.projectId,
          title: `Side: ${source.title}`,
          sidechat: { kind: "thread", threadId: source.id },
          modelSelection: input.modelSelection ?? source.modelSelection,
          runtimeMode: source.runtimeMode,
          interactionMode: source.interactionMode,
          workspaceStrategy:
            source.worktreePath === null
              ? { type: "root", ...(source.branch === null ? {} : { branch: source.branch }) }
              : {
                  type: "existing_worktree",
                  worktreePath: source.worktreePath,
                  ...(source.branch === null ? {} : { branch: source.branch }),
                },
          ...provenance,
        })
        .pipe(Effect.mapError(unavailable));
      return { threadId: launched.threadId };
    });
    const sendToParent = Effect.fn("SidechatService.sendToParent")(function* (
      input: SidechatSendToParentInput,
      provenance: Provenance,
    ) {
      if (Option.isNone(decodeReturn(input)))
        return yield* new SidechatOperationError({
          reason: "invalid-input",
          message: "Review some text before sending it to the parent.",
        });
      const child = yield* read(input.sidechatThreadId);
      const parentId = child.sidechatSourceThreadId;
      if (parentId == null)
        return yield* new SidechatOperationError({
          reason: "invalid-input",
          message: "This side chat has no parent conversation.",
        });
      const previous = yield* receipts
        .getByCommandId(input.commandId)
        .pipe(Effect.mapError(unavailable));
      if (Option.isSome(previous)) {
        const receipt = previous.value;
        if (
          receipt.threadId !== parentId ||
          receipt.commandType !== "message.dispatch" ||
          receipt.status !== "accepted"
        )
          return yield* new SidechatOperationError({
            reason: "request-conflict",
            message: receipt.error ?? "This command was already used for another operation.",
          });
        return { threadId: parentId, sequence: receipt.resultSequence };
      }
      const parent = yield* read(parentId);
      if (child.deletedAt !== null || parent.deletedAt !== null)
        return yield* new SidechatOperationError({
          reason: "not-found",
          message: "The parent conversation is unavailable.",
        });
      const result = yield* threads
        .sendToThread({
          projectId: parent.projectId,
          commandId: input.commandId,
          threadId: parentId,
          messageId: MessageId.make(`side-return:${input.commandId}`),
          text: input.text,
          attachments: [],
          mode: "queue",
          ...provenance,
        })
        .pipe(Effect.mapError(unavailable));
      return { threadId: parentId, sequence: result.dispatch.sequence };
    });
    return {
      open: (input, provenance) => locks.withLock(input.commandId, open(input, provenance)),
      sendToParent: (input, provenance) =>
        locks.withLock(input.commandId, sendToParent(input, provenance)),
    };
  }),
);
