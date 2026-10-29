// Range and recap behavior adapted from Synara revision 3f55b77ef186764050ecf4edd6ae0879eec948a8.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import {
  INBOX_RECAP_MAX_WINDOW_MS,
  InboxRecapError,
  InboxRecapInput,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TurnTokenUsage,
  type InboxRecap,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export class InboxRecapService extends Context.Service<
  InboxRecapService,
  {
    readonly read: (input: InboxRecapInput) => Effect.Effect<InboxRecap, InboxRecapError>;
  }
>()("t3/inbox/InboxRecapService") {}

const decodeInput = Schema.decodeUnknownEffect(InboxRecapInput);
const decodeUsage = Schema.decodeUnknownOption(Schema.fromJsonString(TurnTokenUsage));
interface Range {
  readonly from: string;
  readonly to: string;
  readonly fromMs: number;
  readonly toMs: number;
}
interface ProjectRow {
  readonly projectId: string | null;
  readonly projectTitle: string | null;
}
interface ModelRow {
  readonly providerInstanceId: string;
  readonly driver: string;
  readonly model: string;
}
interface PromptRow extends ProjectRow {
  readonly threadId: string;
  readonly messageId: string;
  readonly createdAt: string;
}
interface RunRow extends ModelRow {
  readonly requestedAt: string;
  readonly status: string;
}
interface TurnRow extends ModelRow, ProjectRow {
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly status: string;
  readonly usageJson: string | null;
  readonly origin: "user" | "automation" | "agent";
}
const instant = (value: string) => Option.map(DateTime.make(value), DateTime.toEpochMillis);
const range = (fromMs: number, toMs: number): Range => ({
  fromMs,
  toMs,
  from: DateTime.formatIso(DateTime.makeUnsafe(fromMs)),
  to: DateTime.formatIso(DateTime.makeUnsafe(toMs)),
});
const within = (at: number, value: Range) => at >= value.fromMs && at < value.toMs;
function bucket(value: Range) {
  return {
    range: value,
    threads: new Set<string>(),
    slot: {
      from: value.from,
      to: value.to,
      prompts: 0,
      chats: 0,
      turns: 0,
      failedTurns: 0,
      agentWorkMs: 0,
      tokens: { user: 0, automation: 0, agent: 0 },
      cacheReadTokens: 0,
      incompleteUsageTurns: 0,
    },
  };
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const read = Effect.fn("InboxRecapService.read")(function* (input: InboxRecapInput) {
    const valid = yield* decodeInput(input).pipe(
      Effect.mapError(() => new InboxRecapError({ reason: "invalid-window" })),
    );
    const instants = [valid.from, ...valid.slotBoundaries, valid.to].map(instant);
    const edges: number[] = [];
    for (const value of instants) {
      if (Option.isNone(value) || (edges.length > 0 && value.value <= edges[edges.length - 1]!))
        return yield* new InboxRecapError({ reason: "invalid-window" });
      edges.push(value.value);
    }
    const fromMs = edges[0]!;
    const toMs = edges[edges.length - 1]!;
    if (toMs - fromMs > INBOX_RECAP_MAX_WINDOW_MS)
      return yield* new InboxRecapError({ reason: "invalid-window" });
    const window = range(fromMs, toMs);
    const slots = edges.slice(1).map((end, index) => range(edges[index]!, end));
    const now = yield* DateTime.now;
    const nowMs = DateTime.toEpochMillis(now);
    const lookback = DateTime.formatIso(DateTime.makeUnsafe(fromMs - 24 * 3_600_000));
    const nativeChild = sql`NOT (COALESCE(json_extract(th.payload_json,'$.lineage.relationshipToParent'),'') = 'subagent' AND COALESCE(json_extract(th.payload_json,'$.creationSource'),'') = 'provider')`;
    const rows = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          // Dispatch receipts distinguish human sends (including steering) from imported provider history.
          const prompts = yield* sql<PromptRow>`
        SELECT DISTINCT e.stream_id AS "threadId", json_extract(e.payload_json,'$.id') AS "messageId",
          json_extract(e.payload_json,'$.createdAt') AS "createdAt", p.project_id AS "projectId", p.title AS "projectTitle"
        FROM orchestration_events e
        JOIN orchestration_command_receipts receipt ON receipt.command_id=e.command_id
          AND receipt.status='accepted' AND receipt.command_type IN ('message.dispatch','queued-message.promote-to-steer')
        LEFT JOIN orchestration_v2_projection_threads th ON th.thread_id=e.stream_id
        LEFT JOIN projection_projects p ON p.project_id=th.project_id AND p.deleted_at IS NULL
        WHERE e.aggregate_kind='thread' AND e.application_event_version=2 AND e.event_type='message.updated'
          AND e.occurred_at>=${window.from} AND e.occurred_at<${window.to}
          AND json_extract(e.payload_json,'$.role')='user' AND json_extract(e.payload_json,'$.createdBy')='user'
          AND json_extract(e.payload_json,'$.scheduledTaskId') IS NULL AND json_extract(e.payload_json,'$.notification') IS NULL
          AND json_extract(e.payload_json,'$.createdAt')>=${window.from} AND json_extract(e.payload_json,'$.createdAt')<${window.to}
          AND ${nativeChild}
      `;
          const runs = yield* sql<RunRow>`
        SELECT r.requested_at AS "requestedAt", r.status, COALESCE(r.provider_instance_id,'unknown') AS "providerInstanceId",
          COALESCE(pt.driver,'unknown') AS driver, COALESCE(json_extract(r.payload_json,'$.modelSelection.model'),'unknown') AS model
        FROM orchestration_v2_projection_runs r
        JOIN orchestration_v2_projection_threads th ON th.thread_id=r.thread_id
        LEFT JOIN orchestration_v2_projection_provider_threads pt ON pt.provider_thread_id=r.provider_thread_id
        WHERE r.requested_at>=${window.from} AND r.requested_at<${window.to} AND ${nativeChild}
      `;
          const turns = yield* sql<TurnRow>`
        SELECT turn.started_at AS "startedAt", turn.completed_at AS "completedAt", turn.status,
          json_extract(turn.payload_json,'$.turnTokenUsage') AS "usageJson",
          COALESCE(pt.provider_instance_id,r.provider_instance_id,'unknown') AS "providerInstanceId",
          COALESCE(pt.driver,'unknown') AS driver, COALESCE(json_extract(r.payload_json,'$.modelSelection.model'),'unknown') AS model,
          CASE WHEN json_extract(message.payload_json,'$.scheduledTaskId') IS NOT NULL THEN 'automation'
            WHEN json_extract(message.payload_json,'$.createdBy')='user' THEN 'user' ELSE 'agent' END AS origin,
          p.project_id AS "projectId", p.title AS "projectTitle"
        FROM orchestration_v2_projection_provider_turns turn
        JOIN orchestration_v2_projection_threads th ON th.thread_id=turn.thread_id
        LEFT JOIN orchestration_v2_projection_provider_threads pt ON pt.provider_thread_id=turn.provider_thread_id
        LEFT JOIN orchestration_v2_projection_run_attempts attempt ON attempt.attempt_id=turn.run_attempt_id
        LEFT JOIN orchestration_v2_projection_runs r ON r.run_id=attempt.run_id AND r.thread_id=turn.thread_id
        LEFT JOIN orchestration_v2_projection_messages message ON message.thread_id=turn.thread_id AND message.message_id=json_extract(r.payload_json,'$.userMessageId')
        LEFT JOIN projection_projects p ON p.project_id=th.project_id AND p.deleted_at IS NULL
        WHERE ${nativeChild} AND (
          (turn.completed_at>=${window.from} AND turn.completed_at<${window.to}) OR
          (turn.started_at<${window.to} AND turn.completed_at>=${window.from}) OR
          (turn.status='running' AND turn.completed_at IS NULL AND turn.started_at>=${lookback} AND turn.started_at<${window.to})
        )
      `;
          return { prompts, runs, turns };
        }),
      )
      .pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError((cause) => new InboxRecapError({ reason: "persistence", cause })),
      );
    const buckets = [window, ...slots].map(bucket);
    const projects = new Map<
      string,
      { id: string; title: string; prompts: number; threads: Set<string>; tokens: number }
    >();
    const models = new Map<
      string,
      {
        providerInstanceId: ProviderInstanceId;
        driver: ProviderDriverKind;
        model: string;
        turns: number;
        tokens: number;
      }
    >();
    const unavailable = new Set<ProviderDriverKind>();
    const projectFor = (row: ProjectRow) => {
      if (row.projectId === null || row.projectTitle === null) return null;
      let value = projects.get(row.projectId);
      if (!value) {
        value = {
          id: row.projectId,
          title: row.projectTitle.trim() || "Untitled project",
          prompts: 0,
          threads: new Set(),
          tokens: 0,
        };
        projects.set(row.projectId, value);
      }
      return value;
    };
    const modelFor = (row: ModelRow) => {
      const key = JSON.stringify([row.providerInstanceId, row.driver, row.model]);
      let value = models.get(key);
      if (!value) {
        value = {
          providerInstanceId: ProviderInstanceId.make(row.providerInstanceId),
          driver: ProviderDriverKind.make(row.driver),
          model: row.model,
          turns: 0,
          tokens: 0,
        };
        models.set(key, value);
      }
      return value;
    };
    for (const prompt of rows.prompts) {
      const at = Option.getOrElse(instant(prompt.createdAt), () => Number.NaN);
      for (const value of buckets)
        if (within(at, value.range)) {
          value.slot.prompts++;
          value.threads.add(prompt.threadId);
          value.slot.chats = value.threads.size;
        }
      const project = projectFor(prompt);
      if (project) {
        project.prompts++;
        project.threads.add(prompt.threadId);
      }
    }
    for (const run of rows.runs) {
      const at = Option.getOrElse(instant(run.requestedAt), () => Number.NaN);
      for (const value of buckets)
        if (within(at, value.range)) {
          value.slot.turns++;
          if (run.status === "failed") value.slot.failedTurns++;
        }
      modelFor(run).turns++;
    }
    for (const turn of rows.turns) {
      const start =
        turn.startedAt === null
          ? Number.NaN
          : Option.getOrElse(instant(turn.startedAt), () => Number.NaN);
      const end =
        turn.completedAt === null
          ? turn.status === "running"
            ? nowMs
            : Number.NaN
          : Option.getOrElse(instant(turn.completedAt), () => Number.NaN);
      if (Number.isFinite(start) && Number.isFinite(end))
        for (const value of buckets)
          value.slot.agentWorkMs += Math.max(
            0,
            Math.round(Math.min(end, value.range.toMs) - Math.max(start, value.range.fromMs)),
          );
      const usageAt = turn.completedAt === null && turn.status === "running" ? nowMs : end;
      if (!within(usageAt, window)) continue;
      const usage = turn.usageJson === null ? null : Option.getOrNull(decodeUsage(turn.usageJson));
      // Context occupancy is not a token delta. Main-agent input includes cache; output includes reasoning.
      const tokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
      const incomplete = usage?.usageStatus !== "complete" || usage.hasSubagents;
      for (const value of buckets)
        if (within(usageAt, value.range)) {
          value.slot.tokens[turn.origin] += tokens;
          value.slot.cacheReadTokens += usage?.cachedInputTokens ?? 0;
          if (incomplete) value.slot.incompleteUsageTurns++;
        }
      if (incomplete) unavailable.add(ProviderDriverKind.make(turn.driver));
      const project = projectFor(turn);
      if (project) project.tokens += tokens;
      modelFor(turn).tokens += tokens;
    }
    const [totals, ...resultSlots] = buckets.map((value) => value.slot);
    return {
      generatedAt: DateTime.formatIso(now),
      totals: totals!,
      slots: resultSlots,
      projects: [...projects.values()]
        .filter((project) => project.prompts > 0 || project.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens || b.prompts - a.prompts || a.id.localeCompare(b.id))
        .slice(0, 5)
        .map((value) => ({
          projectId: ProjectId.make(value.id),
          title: value.title,
          prompts: value.prompts,
          chats: value.threads.size,
          tokens: value.tokens,
        })),
      models: [...models.values()].sort(
        (a, b) =>
          b.tokens - a.tokens ||
          b.turns - a.turns ||
          JSON.stringify([a.providerInstanceId, a.model]).localeCompare(
            JSON.stringify([b.providerInstanceId, b.model]),
          ),
      ),
      unavailableProviders: [...unavailable].sort(),
    };
  });
  return InboxRecapService.of({ read });
});

export const layer = Layer.effect(InboxRecapService, make);
