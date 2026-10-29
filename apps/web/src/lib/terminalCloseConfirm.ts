import type { EnvironmentId, ScopedThreadRef, TerminalSummary } from "@t3tools/contracts";
import { resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";
import { readLocalApi } from "~/localApi";

let pendingConfirmations = 0;

export function isTerminalCloseConfirmPending(): boolean {
  return pendingConfirmations > 0;
}

export async function confirmTerminalClose(
  labels: readonly [string, ...string[]],
): Promise<boolean> {
  const localApi = readLocalApi();
  if (!localApi) return true;
  pendingConfirmations += 1;
  try {
    return await localApi.dialogs.confirm(
      labels.length === 1
        ? [
            `Close terminal "${labels[0]}"?`,
            "This stops the running process and clears its history.",
          ].join("\n")
        : [
            `Close ${labels.length} terminals?`,
            `This stops their running processes and clears their histories: ${labels
              .map((label) => `"${label}"`)
              .join(", ")}.`,
          ].join("\n"),
      { variant: "destructive" },
    );
  } catch {
    return false;
  } finally {
    pendingConfirmations -= 1;
  }
}

export function terminalCloseLabels(input: {
  readonly owner: ScopedThreadRef;
  readonly target: ScopedThreadRef;
  readonly activeTerminalId: string;
  readonly terminalIds: readonly string[];
  readonly ownerLabels: ReadonlyMap<string, string>;
  readonly metadata: {
    readonly environmentId: EnvironmentId;
    readonly summaries: readonly Pick<TerminalSummary, "threadId" | "terminalId" | "label">[];
  } | null;
}): readonly [string, ...string[]] {
  const isOwner =
    input.owner.environmentId === input.target.environmentId &&
    input.owner.threadId === input.target.threadId;
  const label = (terminalId: string) => {
    if (isOwner)
      return input.ownerLabels.get(terminalId) ?? resolveTerminalSessionLabel(terminalId, null);
    const summary =
      input.metadata?.environmentId === input.target.environmentId
        ? input.metadata.summaries.find(
            (item) => item.threadId === input.target.threadId && item.terminalId === terminalId,
          )
        : undefined;
    return resolveTerminalSessionLabel(terminalId, summary);
  };
  return [
    label(input.activeTerminalId),
    ...input.terminalIds.filter((id) => id !== input.activeTerminalId).map(label),
  ];
}
