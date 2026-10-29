import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type InboxRecap,
} from "@t3tools/contracts";
import { aggregateInboxRecaps } from "./dockInboxRecap.logic";

const input = {
  from: "2026-10-24T08:00:00.000Z",
  to: "2026-10-25T08:00:00.000Z",
  slotBoundaries: [],
};
function recap(tokens: number, generatedAt = "2026-10-24T12:00:00.000Z"): InboxRecap {
  const totals = {
    from: input.from,
    to: input.to,
    prompts: 1,
    chats: 1,
    turns: 1,
    failedTurns: 0,
    agentWorkMs: 1_000,
    tokens: { user: tokens, automation: 0, agent: 0 },
    cacheReadTokens: 0,
    incompleteUsageTurns: 0,
  };
  return {
    generatedAt,
    totals,
    slots: [totals],
    projects: [
      { projectId: ProjectId.make("same-project"), title: "App", prompts: 1, chats: 1, tokens },
    ],
    models: [
      {
        providerInstanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        model: "model",
        turns: 1,
        tokens,
      },
    ],
    unavailableProviders: [],
  };
}
describe("aggregateInboxRecaps", () => {
  it("keeps projects environment-scoped, merges model totals and ignores duplicate older snapshots", () => {
    const first = EnvironmentId.make("first"),
      second = EnvironmentId.make("second");
    const result = aggregateInboxRecaps(input, [
      { environmentId: first, recap: recap(10) },
      { environmentId: second, recap: recap(20) },
      { environmentId: first, recap: recap(99, "2026-10-24T10:00:00.000Z") },
    ]);
    expect(result.environments).toBe(2);
    expect(result.totals.tokens.user).toBe(30);
    expect(result.totals.chats).toBe(2);
    expect(result.projects.map((project) => project.environmentId).sort()).toEqual([first, second]);
    expect(result.models[0]).toMatchObject({ model: "model", turns: 2, tokens: 30 });
  });
  it("matches slots by absolute instant and never mixes a different working day into the recap", () => {
    const equivalent = recap(20);
    const sameSlot = {
      ...equivalent.slots[0]!,
      from: "2026-10-24T04:00:00-04:00",
      to: "2026-10-25T04:00:00-04:00",
    };
    const different = recap(100);
    const result = aggregateInboxRecaps(input, [
      { environmentId: EnvironmentId.make("a"), recap: { ...equivalent, slots: [sameSlot] } },
      {
        environmentId: EnvironmentId.make("b"),
        recap: { ...different, totals: { ...different.totals, from: "2026-10-23T08:00:00.000Z" } },
      },
    ]);
    expect(result.environments).toBe(1);
    expect(result.slots[0]?.tokens.user).toBe(20);
  });
  it("exposes missing token coverage and distinguishes no sources from a zero-activity snapshot", () => {
    const partial = recap(3);
    const result = aggregateInboxRecaps(input, [
      {
        environmentId: EnvironmentId.make("a"),
        recap: {
          ...partial,
          totals: { ...partial.totals, incompleteUsageTurns: 2 },
          unavailableProviders: [ProviderDriverKind.make("codex")],
        },
      },
    ]);
    expect(result.totals.incompleteUsageTurns).toBe(2);
    expect(result.unavailableProviders).toHaveLength(1);
    expect(aggregateInboxRecaps(input, [])).toMatchObject({
      environments: 0,
      totals: { prompts: 0 },
    });
  });
});
