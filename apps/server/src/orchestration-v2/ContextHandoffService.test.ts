import { assert, it } from "@effect/vitest";
import {
  MessageId,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ContextHandoffService from "./ContextHandoffService.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProjectionStore from "./ProjectionStore.ts";

const layerBase = ContextHandoffService.layer.pipe(Layer.provide(IdAllocator.layer));
const layerTest = layerBase.pipe(
  Layer.provide(
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getSidechatSnapshot: () => Effect.succeed(null),
    }),
  ),
);

it.effect(
  "retains the frozen reference in a full provider replacement handoff under the shared budget",
  () =>
    Effect.gen(function* () {
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const handoff = yield* service.prepareProviderHandoff({
        threadId: ThreadId.make("side"),
        targetRunId: RunId.make("replacement-run"),
        transferId: null,
        fromProviderThreadIds: [ProviderThreadId.make("old")],
        toProviderThreadId: ProviderThreadId.make("new"),
        fromProviderInstanceId: ProviderInstanceId.make("codex"),
        toProviderInstanceId: ProviderInstanceId.make("claude"),
        coveredRunOrdinals: { from: 1, to: 2 },
        strategy: "full_thread_summary",
        items: [
          importedItem({
            role: "user",
            id: "side-question",
            text: "Current side question",
            ordinal: 0,
          }),
        ],
        createdAt: DateTime.makeUnsafe("2026-10-26T12:00:00.000Z"),
      });
      assert.include(
        handoff.history?.messages.map((message) => message.text) ?? [],
        "Frozen parent answer",
      );
      assert.include(handoff.summaryText, "reference-only");
      assert.include(
        handoff.history?.messages.map((message) => message.text) ?? [],
        "Current side question",
      );
    }).pipe(
      Effect.provide(
        layerBase.pipe(
          Layer.provide(
            Layer.mock(ProjectionStore.ProjectionStoreV2)({
              getSidechatSnapshot: () =>
                Effect.succeed({
                  source: {
                    kind: "thread",
                    threadId: ThreadId.make("parent"),
                    snapshotSequence: 7,
                    capturedAt: "2026-10-26T12:00:00.000Z",
                  },
                  referenceText: "",
                  items: [
                    importedItem({
                      role: "assistant",
                      id: "parent-answer",
                      text: "Frozen parent answer",
                      ordinal: 0,
                    }),
                  ],
                }),
            }),
          ),
        ),
      ),
    ),
);

it.effect(
  "budgets frozen side-chat context without continuing the parent task or creating fork lineage",
  () =>
    Effect.gen(function* () {
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const partial = {
        ...importedItem({ role: "assistant", id: "partial", text: "Frozen partial", ordinal: 0 }),
        status: "running" as const,
      };
      const handoff = yield* service.prepareSidechat({
        threadId: ThreadId.make("side"),
        targetRunId: RunId.make("side-run"),
        toProviderThreadId: ProviderThreadId.make("side-provider"),
        toProviderInstanceId: ProviderInstanceId.make("codex"),
        snapshot: {
          source: {
            kind: "thread",
            threadId: partial.threadId,
            snapshotSequence: 42,
            capturedAt: "2026-10-26T12:00:00.000Z",
          },
          items: [partial],
          referenceText: "",
        },
        createdAt: DateTime.makeUnsafe("2026-10-26T12:01:00.000Z"),
      });
      assert.equal(handoff.strategy, "manual_context");
      assert.isNull(handoff.transferId);
      assert.equal(handoff.history?.messages[0]?.text, "Frozen partial");
      assert.include(handoff.history?.coverage ?? "", "reference-only");
      assert.notInclude(handoff.summaryText, "Imported conversation history");
      assert.equal(handoff.targetRunId, RunId.make("side-run"));
    }).pipe(Effect.provide(layerTest)),
);

function importedItem(
  input:
    | {
        readonly role: "user";
        readonly id: string;
        readonly text: string;
        readonly ordinal: number;
      }
    | {
        readonly role: "assistant";
        readonly id: string;
        readonly text: string;
        readonly ordinal: number;
      },
): OrchestrationV2TurnItem {
  const now = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
  const base = {
    id: TurnItemId.make(`turn-item:${input.id}`),
    threadId: ThreadId.make("thread:legacy-context"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: input.ordinal,
    status: "completed" as const,
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    messageId: MessageId.make(`message:${input.id}`),
    text: input.text,
  };
  return input.role === "user"
    ? {
        ...base,
        createdBy: "user",
        creationSource: "server",
        type: "user_message",
        inputIntent: "turn_start",
        attachments: [],
      }
    : {
        ...base,
        type: "assistant_message",
        streaming: false,
      };
}

it.layer(layerTest)("ContextHandoffService legacy import", (it) => {
  it.effect("prepares imported history for the first native v2 turn", () =>
    Effect.gen(function* () {
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const handoff = yield* service.prepareLegacyImport({
        threadId: ThreadId.make("thread:legacy-context"),
        targetRunId: RunId.make("run:first-v2"),
        toProviderThreadId: ProviderThreadId.make("provider-thread:first-v2"),
        toProviderInstanceId: ProviderInstanceId.make("codex"),
        items: [
          importedItem({ role: "user", id: "one", text: "What did we decide?", ordinal: 1 }),
          importedItem({
            role: "assistant",
            id: "two",
            text: "We decided to keep the migration lightweight.",
            ordinal: 2,
          }),
        ],
        createdAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
      });

      assert.equal(handoff.strategy, "manual_context");
      assert.deepStrictEqual(handoff.fromProviderThreadIds, []);
      assert.include(handoff.summaryText, "What did we decide?");
      assert.include(handoff.summaryText, "keep the migration lightweight");
      const providerMessage = ContextHandoffService.providerMessageWithContextHandoff({
        handoff,
        userText: "Continue from there.",
      });
      assert.include(providerMessage, handoff.summaryText);
      assert.include(providerMessage, "User message:\nContinue from there.");
    }),
  );

  it.effect("preserves role attribution when truncating imported history", () =>
    Effect.gen(function* () {
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const handoff = yield* service.prepareLegacyImport({
        threadId: ThreadId.make("thread:legacy-context"),
        targetRunId: RunId.make("run:first-v2"),
        toProviderThreadId: ProviderThreadId.make("provider-thread:first-v2"),
        toProviderInstanceId: ProviderInstanceId.make("codex"),
        items: [
          importedItem({
            role: "user",
            id: "long",
            text: `${"x".repeat(35_000)} retained final words`,
            ordinal: 1,
          }),
        ],
        createdAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
      });

      assert.isAtMost(handoff.summaryText.length, 32_000);
      assert.include(handoff.summaryText, "User:\n... retained final words");
      assert.notMatch(handoff.summaryText, /\n+x+ retained final words/);
    }),
  );

  it.effect("retains the newest oversized import even when it has no whitespace", () =>
    Effect.gen(function* () {
      const service = yield* ContextHandoffService.ContextHandoffServiceV2;
      const handoff = yield* service.prepareLegacyImport({
        threadId: ThreadId.make("thread:legacy-context"),
        targetRunId: RunId.make("run:first-v2"),
        toProviderThreadId: ProviderThreadId.make("provider-thread:first-v2"),
        toProviderInstanceId: ProviderInstanceId.make("codex"),
        items: [
          importedItem({
            role: "assistant",
            id: "older",
            text: "older message",
            ordinal: 1,
          }),
          importedItem({
            role: "user",
            id: "long-single-token",
            text: `${"🧪".repeat(20_000)}LATEST_SINGLE_TOKEN`,
            ordinal: 2,
          }),
        ],
        createdAt: DateTime.makeUnsafe("2026-01-02T00:00:00.000Z"),
      });

      assert.include(
        handoff.history?.omittedItemIds ?? [],
        TurnItemId.make("turn-item:long-single-token"),
      );
      assert.isAtMost(handoff.summaryText.length, 32_000);
      assert.include(handoff.summaryText, "User:\n... ");
      assert.include(handoff.summaryText, "LATEST_SINGLE_TOKEN");
      assert.notInclude(handoff.summaryText, "\ufffd");
    }),
  );
});
