import {
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
  type UsageLimitSourceAccount,
  type UsageLimitSourceId,
} from "@t3tools/contracts";
import {
  createUsageAccountKeyResolver,
  limitsNotice,
  type LimitPresentations,
} from "@t3tools/shared/usageLimits";

export type DockProviderShowcaseMember =
  | {
      readonly kind: "provider";
      readonly instanceId: ProviderInstanceId;
      readonly environmentId: EnvironmentId;
      readonly environmentLabel: string;
      readonly connected: boolean;
    }
  | {
      readonly kind: "usageLimitSource";
      readonly sourceId: UsageLimitSourceId;
      readonly accountId: string;
      readonly sourceLabel: string;
      readonly environmentId: EnvironmentId;
      readonly environmentLabel: string;
      readonly connected: boolean;
    };

export interface DockProviderShowcaseAccount {
  /** Stable identity for client-local selection; independent of the report owner. */
  readonly selectionKey: string;
  readonly driver: ServerProvider["driver"];
  readonly displayName: string | null;
  readonly email: string | undefined;
  readonly members: readonly DockProviderShowcaseMember[];
  /** The newest complete healthy report for this identity, never merged across accounts. */
  readonly usageLimits: ServerProviderUsageLimits | null;
}

interface AccountReport {
  readonly driver: ServerProvider["driver"];
  readonly email: string | undefined;
  readonly workspaceId: string | undefined;
  readonly usageLimits: ServerProviderUsageLimits | undefined;
}

interface AccountCandidate {
  readonly member: DockProviderShowcaseMember;
  readonly driver: ServerProvider["driver"];
  readonly displayName: string | null;
  readonly email: string | undefined;
  readonly usageLimits: ServerProviderUsageLimits | undefined;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function memberSortKey(member: DockProviderShowcaseMember): string {
  return member.kind === "provider"
    ? JSON.stringify([member.environmentId, "provider", member.instanceId])
    : JSON.stringify([member.environmentId, "source", member.sourceId, member.accountId]);
}

function fallbackSelectionKey(
  environmentId: EnvironmentId,
  member: DockProviderShowcaseMember,
  driver: ServerProvider["driver"],
): string {
  return member.kind === "provider"
    ? JSON.stringify(["provider", environmentId, driver, member.instanceId])
    : JSON.stringify(["source", environmentId, driver, member.sourceId, member.accountId]);
}

function nativeReport(provider: ServerProvider): AccountReport {
  return {
    driver: provider.driver,
    email: provider.auth.email,
    workspaceId: provider.auth.workspaceId,
    usageLimits: provider.usageLimits,
  };
}

function sourceReport(account: UsageLimitSourceAccount): AccountReport {
  return {
    driver: account.driver,
    email: account.email,
    workspaceId: account.workspaceId,
    usageLimits: account.usageLimits,
  };
}

function usableLimits(candidate: AccountCandidate): candidate is AccountCandidate & {
  readonly usageLimits: ServerProviderUsageLimits;
} {
  return candidate.usageLimits !== undefined && limitsNotice(candidate.usageLimits) === null;
}

/** Builds grouped provider accounts from the snapshots already present in the client. */
export function buildDockProviderShowcaseAccounts(
  presentations: LimitPresentations,
  connectedEnvironmentIds: ReadonlySet<EnvironmentId>,
): readonly DockProviderShowcaseAccount[] {
  const reports = [...presentations.values()].flatMap((presentation) => [
    ...(presentation.serverConfig?.providers ?? [])
      .filter((provider) => provider.enabled)
      .map(nativeReport),
    ...(presentation.serverConfig?.usageLimitSources ?? []).flatMap((source) =>
      source.accounts.map(sourceReport),
    ),
  ]);
  const resolveKey = createUsageAccountKeyResolver(reports);
  const groups = new Map<string, AccountCandidate[]>();

  const add = (
    environmentId: EnvironmentId,
    report: AccountReport,
    member: DockProviderShowcaseMember,
    displayName: string | null,
  ) => {
    const selectionKey =
      resolveKey(report) ?? fallbackSelectionKey(environmentId, member, report.driver);
    const candidates = groups.get(selectionKey);
    const candidate = {
      member,
      driver: report.driver,
      displayName,
      email: report.email,
      usageLimits: report.usageLimits,
    } satisfies AccountCandidate;
    if (candidates) candidates.push(candidate);
    else groups.set(selectionKey, [candidate]);
  };

  for (const [environmentId, presentation] of presentations) {
    const environmentLabel = presentation.entry.target.label;
    for (const provider of presentation.serverConfig?.providers ?? []) {
      if (!provider.enabled) continue;
      add(
        environmentId,
        nativeReport(provider),
        {
          kind: "provider",
          instanceId: provider.instanceId,
          environmentId,
          environmentLabel,
          connected: connectedEnvironmentIds.has(environmentId),
        },
        provider.displayName?.trim() || null,
      );
    }
    for (const source of presentation.serverConfig?.usageLimitSources ?? []) {
      for (const account of source.accounts) {
        add(
          environmentId,
          sourceReport(account),
          {
            kind: "usageLimitSource",
            sourceId: source.id,
            accountId: account.id,
            sourceLabel: source.label,
            environmentId,
            environmentLabel,
            connected: connectedEnvironmentIds.has(environmentId),
          },
          account.email ? null : account.id.replace(/\.json$/i, ""),
        );
      }
    }
  }

  return [...groups]
    .map(([selectionKey, candidates]) => {
      const ordered = [...candidates].sort((left, right) =>
        compareText(memberSortKey(left.member), memberSortKey(right.member)),
      );
      const healthy = ordered
        .filter(usableLimits)
        .sort(
          (left, right) =>
            (Date.parse(right.usageLimits.checkedAt) || 0) -
              (Date.parse(left.usageLimits.checkedAt) || 0) ||
            compareText(memberSortKey(left.member), memberSortKey(right.member)),
        );
      const names = ordered
        .flatMap((candidate) => (candidate.displayName ? [candidate.displayName] : []))
        .sort(compareText);
      const emails = ordered
        .flatMap((candidate) => (candidate.email ? [candidate.email] : []))
        .sort(compareText);

      return {
        selectionKey,
        driver: ordered[0]!.driver,
        displayName: names[0] ?? null,
        email: emails[0],
        members: ordered.map((candidate) => candidate.member),
        usageLimits: healthy[0]?.usageLimits ?? null,
      };
    })
    .sort(
      (left, right) =>
        compareText(left.driver, right.driver) ||
        compareText(left.displayName ?? "", right.displayName ?? "") ||
        compareText(left.email ?? "", right.email ?? "") ||
        compareText(left.selectionKey, right.selectionKey),
    );
}

/** Keeps valid client-local identities in order, including identities currently unavailable. */
export function normalizeDockProviderSelections(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const selections: string[] = [];
  const seen = new Set<string>();
  for (const key of raw) {
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.length > 2_048 ||
      key.trim() !== key ||
      seen.has(key)
    ) {
      continue;
    }
    seen.add(key);
    selections.push(key);
  }
  return selections;
}
