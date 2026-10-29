import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Inbox from "./InboxRecapService.ts";

const input = {
  from: "2026-10-24T04:00:00.000Z",
  to: "2026-10-25T04:00:00.000Z",
  slotBoundaries: ["2026-10-24T12:00:00.000Z", "2026-10-24T18:00:00.000Z"],
};
const layer = Inbox.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));

it.effect("does not rank projects that have no reported prompts or tokens", () =>
  Effect.gen(function* () {
    yield* seed();
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM orchestration_events`;
    yield* sql`DELETE FROM orchestration_v2_projection_provider_turns WHERE provider_turn_id!='turn-automation'`;
    yield* sql`UPDATE orchestration_v2_projection_provider_turns SET payload_json='{}'`;
    const recap = yield* (yield* Inbox.InboxRecapService).read(input);
    assert.equal(recap.totals.agentWorkMs, 3_600_000);
    assert.equal(recap.totals.incompleteUsageTurns, 1);
    assert.deepEqual(recap.projects, []);
  }).pipe(Effect.provide(layer)),
);

it.effect("retains selected-model totals so clients can rank models across environments", () =>
  Effect.gen(function* () {
    yield* seed();
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE orchestration_v2_projection_runs SET payload_json=json_set(payload_json,'$.modelSelection.model',run_id)`;
    for (const ordinal of [5, 6])
      yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id,thread_id,ordinal,provider,provider_instance_id,provider_thread_id,status,requested_at,completed_at,payload_json)
    SELECT ${`run-${ordinal}`},thread_id,${ordinal},provider,provider_instance_id,provider_thread_id,status,requested_at,completed_at,json_set(payload_json,'$.modelSelection.model',${`model-${ordinal}`}) FROM orchestration_v2_projection_runs WHERE run_id='run-human'`;
    assert.equal((yield* (yield* Inbox.InboxRecapService).read(input)).models.length, 6);
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "measures running work up to the injected clock and excludes abandoned running turns",
  () =>
    Effect.gen(function* () {
      yield* seed();
      yield* TestClock.setTime(Date.parse("2026-10-24T12:15:00.000Z"));
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM orchestration_v2_projection_provider_turns WHERE provider_turn_id!='turn-human'`;
      yield* sql`UPDATE orchestration_v2_projection_provider_turns SET status='running',completed_at=NULL,payload_json='{}' WHERE provider_turn_id='turn-human'`;
      const inbox = yield* Inbox.InboxRecapService;
      const active = yield* inbox.read(input);
      assert.equal(active.totals.agentWorkMs, 45 * 60_000);
      assert.equal(active.slots[0]?.agentWorkMs, 30 * 60_000);
      assert.equal(active.slots[1]?.agentWorkMs, 15 * 60_000);
      assert.equal(active.totals.incompleteUsageTurns, 1);
      yield* sql`UPDATE orchestration_v2_projection_provider_turns SET started_at='2026-10-22T11:30:00.000Z' WHERE provider_turn_id='turn-human'`;
      assert.equal((yield* inbox.read(input)).totals.agentWorkMs, 0);
    }).pipe(Effect.provide(layer)),
);

it.effect("uses absolute instants across a repeated daylight-saving hour", () =>
  Effect.gen(function* () {
    yield* seed();
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM orchestration_v2_projection_provider_turns WHERE provider_turn_id!='turn-human'`;
    yield* sql`UPDATE orchestration_v2_projection_provider_turns SET started_at='2026-11-01T05:30:00.000Z',completed_at='2026-11-01T06:30:00.000Z' WHERE provider_turn_id='turn-human'`;
    const recap = yield* (yield* Inbox.InboxRecapService).read({
      from: "2026-10-31T04:00:00-04:00",
      to: "2026-11-01T04:00:00-05:00",
      slotBoundaries: ["2026-10-31T12:00:00-04:00", "2026-10-31T18:00:00-04:00"],
    });
    assert.equal(Date.parse(recap.totals.to) - Date.parse(recap.totals.from), 25 * 3_600_000);
    assert.equal(recap.totals.agentWorkMs, 3_600_000);
    assert.equal(recap.slots[2]?.agentWorkMs, 3_600_000);
  }).pipe(Effect.provide(layer)),
);

it.effect(
  "excludes provider-native children, retains app-owned work and avoids ranking deleted projects",
  () =>
    Effect.gen(function* () {
      yield* seed();
      const sql = yield* SqlClient.SqlClient;
      const inbox = yield* Inbox.InboxRecapService;
      yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json='{"lineage":{"relationshipToParent":"subagent"},"creationSource":"provider"}'`;
      const native = yield* inbox.read(input);
      assert.equal(native.totals.turns, 0);
      assert.equal(native.totals.prompts, 0);
      assert.equal(native.totals.agentWorkMs, 0);
      yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json='{"lineage":{"relationshipToParent":"subagent"},"creationSource":"mcp"}',archived_at='2026-10-25T00:00:00.000Z'`;
      yield* sql`UPDATE projection_projects SET deleted_at='2026-10-25T00:00:00.000Z'`;
      const archived = yield* inbox.read(input);
      assert.equal(archived.totals.turns, 4);
      assert.equal(archived.totals.tokens.user, 120);
      assert.deepEqual(archived.projects, []);
    }).pipe(Effect.provide(layer)),
);

it.effect("rejects invalid, reversed, overlong or unordered recap windows", () =>
  Effect.gen(function* () {
    const inbox = yield* Inbox.InboxRecapService;
    for (const bad of [
      { ...input, from: "invalid" },
      { ...input, to: input.from },
      { ...input, to: "2026-10-27T04:00:00.000Z" },
      { ...input, slotBoundaries: [input.from] },
      { ...input, slotBoundaries: input.slotBoundaries.toReversed() },
    ])
      assert.equal((yield* inbox.read(bad).pipe(Effect.flip)).reason, "invalid-window");
  }).pipe(Effect.provide(layer)),
);

it.effect("reads an empty environment and normalizes equivalent instants", () =>
  Effect.gen(function* () {
    const inbox = yield* Inbox.InboxRecapService;
    const recap = yield* inbox.read({ ...input, from: "2026-10-24T00:00:00-04:00" });
    assert.equal(recap.totals.from, input.from);
    assert.equal(recap.totals.turns, 0);
    assert.equal(recap.totals.prompts, 0);
    assert.deepEqual(recap.totals.tokens, { user: 0, automation: 0, agent: 0 });
    assert.equal(recap.slots.length, 3);
    assert.deepEqual(recap.models, []);
  }).pipe(Effect.provide(layer)),
);

const seed = Effect.fn("InboxRecapTest.seed")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const at = "2026-10-24T11:30:00.000Z";
  yield* sql`INSERT INTO projection_projects (project_id,title,workspace_root,scripts_json,created_at,updated_at) VALUES ('p','App','/app','[]',${at},${at})`;
  yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES ('t','p','Work','codex','full-access','default',${at},${at},'{}')`;
  yield* sql`INSERT INTO orchestration_v2_projection_provider_threads (provider_thread_id,thread_id,provider,status,updated_at,payload_json,driver,provider_instance_id) VALUES ('pt','t','codex','loaded',${at},'{}','codex','codex')`;
  const specifications = [
    {
      id: "human",
      createdBy: "user",
      extra: {},
      status: "completed",
      usage: {
        usageStatus: "complete",
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 50,
        cacheCreationTokens: 10,
        reasoningTokens: 15,
      },
    },
    {
      id: "automation",
      createdBy: "user",
      extra: { scheduledTaskId: "schedule" },
      status: "completed",
      usage: { usageStatus: "complete", inputTokens: 100, outputTokens: 20 },
    },
    {
      id: "agent",
      createdBy: "agent",
      extra: {},
      status: "failed",
      usage: { usageStatus: "partial", inputTokens: 30 },
    },
    { id: "unavailable", createdBy: "user", extra: {}, status: "completed", usage: null },
  ];
  for (const [index, spec] of specifications.entries()) {
    const message = {
      id: `m-${spec.id}`,
      role: "user",
      createdBy: spec.createdBy,
      creationSource: "web",
      createdAt: at,
      ...spec.extra,
    };
    const messageJson = JSON.stringify(message);
    const runId = `run-${spec.id}`;
    const runJson = JSON.stringify({
      modelSelection: { instanceId: "codex", model: "gpt-6-luna" },
      userMessageId: message.id,
      startedAt: at,
    });
    const turnJson = JSON.stringify({
      turnTokenUsage: spec.usage
        ? { ...spec.usage, usageScope: "main_agent", hasSubagents: false }
        : undefined,
      tokenUsage: { usedTokens: 999999 },
    });
    yield* sql`INSERT INTO orchestration_v2_projection_messages (message_id,thread_id,run_id,role,streaming,created_at,updated_at,payload_json) VALUES (${message.id},'t',${runId},'user',0,${at},${at},${messageJson})`;
    yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id,thread_id,ordinal,provider,provider_instance_id,provider_thread_id,status,requested_at,completed_at,payload_json) VALUES (${runId},'t',${index + 1},'codex','codex','pt',${spec.status},${at},'2026-10-24T12:30:00.000Z',${runJson})`;
    yield* sql`INSERT INTO orchestration_v2_projection_run_attempts (attempt_id,thread_id,run_id,attempt_ordinal,root_node_id,provider,provider_instance_id,provider_thread_id,status,payload_json) VALUES (${`a-${spec.id}`},'t',${runId},1,${`n-${spec.id}`},'codex','codex','pt',${spec.status},'{}')`;
    yield* sql`INSERT INTO orchestration_v2_projection_provider_turns (provider_turn_id,thread_id,provider_thread_id,node_id,run_attempt_id,ordinal,status,started_at,completed_at,payload_json) VALUES (${`turn-${spec.id}`},'t','pt',${`n-${spec.id}`},${`a-${spec.id}`},${index + 1},${spec.status},${at},'2026-10-24T12:30:00.000Z',${turnJson})`;
    yield* sql`INSERT INTO orchestration_command_receipts (command_id,aggregate_kind,aggregate_id,accepted_at,result_sequence,status,command_type) VALUES (${`c-${spec.id}`},'thread','t',${at},${index + 1},'accepted','message.dispatch')`;
    yield* sql`INSERT INTO orchestration_events (event_id,aggregate_kind,stream_id,stream_version,event_type,occurred_at,command_id,actor_kind,payload_json,metadata_json,application_event_version) VALUES (${`e-${spec.id}`},'thread','t',${index + 1},'message.updated',${at},${`c-${spec.id}`},'user',${messageJson},'{}',2)`;
  }
});

it.effect(
  "separates prompt origins, clips overlapping work and counts normalized tokens without cache or reasoning duplication",
  () =>
    Effect.gen(function* () {
      yield* seed();
      const recap = yield* (yield* Inbox.InboxRecapService).read(input);
      assert.equal(recap.totals.prompts, 2);
      assert.equal(recap.totals.chats, 1);
      assert.equal(recap.totals.turns, 4);
      assert.equal(recap.totals.failedTurns, 1);
      assert.deepEqual(recap.totals.tokens, { user: 120, automation: 120, agent: 30 });
      assert.equal(recap.totals.cacheReadTokens, 50);
      assert.equal(recap.totals.incompleteUsageTurns, 2);
      assert.deepEqual(recap.unavailableProviders, [ProviderDriverKind.make("codex")]);
      assert.equal(recap.totals.agentWorkMs, 4 * 3_600_000);
      assert.equal(recap.slots[0]?.agentWorkMs, 4 * 1_800_000);
      assert.equal(recap.slots[1]?.agentWorkMs, 4 * 1_800_000);
      assert.equal(recap.slots[0]?.tokens.user, 0);
      assert.equal(recap.slots[1]?.tokens.user, 120);
      assert.equal(recap.projects[0]?.tokens, 270);
      assert.equal(recap.models[0]?.turns, 4);
      assert.equal(recap.models[0]?.driver, "codex");
    }).pipe(Effect.provide(layer)),
);
