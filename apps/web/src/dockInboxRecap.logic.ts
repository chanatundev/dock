import type {
  EnvironmentId,
  InboxRecap,
  InboxRecapInput,
  InboxRecapSlot,
} from "@t3tools/contracts";

function emptySlot(from: string, to: string) {
  return {
    from,
    to,
    prompts: 0,
    chats: 0,
    turns: 0,
    failedTurns: 0,
    agentWorkMs: 0,
    tokens: { user: 0, automation: 0, agent: 0 },
    cacheReadTokens: 0,
    incompleteUsageTurns: 0,
  };
}
function addSlot(target: ReturnType<typeof emptySlot>, value: InboxRecapSlot) {
  for (const key of [
    "prompts",
    "chats",
    "turns",
    "failedTurns",
    "agentWorkMs",
    "cacheReadTokens",
    "incompleteUsageTurns",
  ] as const)
    target[key] += value[key];
  for (const key of ["user", "automation", "agent"] as const)
    target.tokens[key] += value.tokens[key];
}
const rangeKey = (from: string, to: string) => JSON.stringify([Date.parse(from), Date.parse(to)]);

export function aggregateInboxRecaps(
  input: InboxRecapInput,
  sources: readonly { readonly environmentId: EnvironmentId; readonly recap: InboxRecap }[],
) {
  const latest = new Map<EnvironmentId, InboxRecap>();
  for (const source of sources) {
    if (
      rangeKey(source.recap.totals.from, source.recap.totals.to) !== rangeKey(input.from, input.to)
    )
      continue;
    const previous = latest.get(source.environmentId);
    if (!previous || Date.parse(previous.generatedAt) < Date.parse(source.recap.generatedAt))
      latest.set(source.environmentId, source.recap);
  }
  const totals = emptySlot(input.from, input.to);
  const edges = [input.from, ...input.slotBoundaries, input.to];
  const slots = edges.slice(1).map((to, index) => emptySlot(edges[index]!, to));
  const slotsByRange = new Map(slots.map((slot) => [rangeKey(slot.from, slot.to), slot]));
  const projects: Array<
    InboxRecap["projects"][number] & { readonly environmentId: EnvironmentId }
  > = [];
  const models = new Map<
    string,
    { driver: InboxRecap["models"][number]["driver"]; model: string; turns: number; tokens: number }
  >();
  const unavailableProviders: Array<{
    environmentId: EnvironmentId;
    driver: InboxRecap["unavailableProviders"][number];
  }> = [];
  for (const [environmentId, recap] of latest) {
    addSlot(totals, recap.totals);
    for (const slot of recap.slots) {
      const target = slotsByRange.get(rangeKey(slot.from, slot.to));
      if (target) addSlot(target, slot);
    }
    for (const project of recap.projects) projects.push({ ...project, environmentId });
    for (const model of recap.models) {
      const key = JSON.stringify([model.driver, model.model]);
      const previous = models.get(key);
      if (previous) {
        previous.turns += model.turns;
        previous.tokens += model.tokens;
      } else
        models.set(key, {
          driver: model.driver,
          model: model.model,
          turns: model.turns,
          tokens: model.tokens,
        });
    }
    for (const driver of recap.unavailableProviders)
      unavailableProviders.push({ environmentId, driver });
  }
  return {
    environments: latest.size,
    totals,
    slots,
    projects: projects
      .sort(
        (a, b) =>
          b.tokens - a.tokens ||
          b.prompts - a.prompts ||
          JSON.stringify([a.environmentId, a.projectId]).localeCompare(
            JSON.stringify([b.environmentId, b.projectId]),
          ),
      )
      .slice(0, 5),
    models: [...models.values()]
      .sort(
        (a, b) =>
          b.tokens - a.tokens ||
          b.turns - a.turns ||
          JSON.stringify([a.driver, a.model]).localeCompare(JSON.stringify([b.driver, b.model])),
      )
      .slice(0, 5),
    unavailableProviders,
  };
}
