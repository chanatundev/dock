import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, InboxRecap, InboxRecapInput } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import { useEnvironments } from "./environments";
import { environmentPresentations } from "./presentation";
import { environmentShell } from "./shell";
import { serverEnvironment } from "./server";

export interface InboxEnvironmentRecap {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly status: "ready" | "loading" | "offline" | "unsupported" | "error";
  readonly recap: InboxRecap | null;
  readonly hasThreadSnapshot: boolean;
  readonly connected: boolean;
}
const recapForEnvironment = Atom.family((key: string) => {
  const [environmentId, input] = JSON.parse(key) as [EnvironmentId, InboxRecapInput];
  return Atom.make((get): InboxEnvironmentRecap => {
    const previous = Option.getOrNull(get.self<InboxEnvironmentRecap>());
    const presentation = get(environmentPresentations.presentationAtom(environmentId));
    const config = get(serverEnvironment.configValueAtom(environmentId));
    const hasThreadSnapshot = get(environmentShell.hasSnapshotAtom(environmentId));
    const label = presentation?.entry.target.label ?? environmentId;
    const cached = previous?.recap ?? null;
    const base = {
      environmentId,
      label,
      hasThreadSnapshot,
      connected: presentation?.connection.phase === "connected",
    };
    if (
      presentation?.connection.phase === "unsupported" ||
      (config !== null && config.environment.capabilities.dockInboxRecap !== true)
    )
      return { ...base, status: "unsupported", recap: cached };
    if (!presentation || config === null || presentation.connection.phase !== "connected")
      return {
        ...base,
        status:
          presentation?.connection.phase === "available" || !presentation ? "loading" : "offline",
        recap: cached,
      };
    const result = get(serverEnvironment.inboxRecap({ environmentId, input }));
    return {
      ...base,
      status: AsyncResult.isSuccess(result)
        ? "ready"
        : AsyncResult.isFailure(result)
          ? "error"
          : "loading",
      recap: Option.getOrNull(AsyncResult.value(result)) ?? cached,
    };
  }).pipe(Atom.withLabel(`web-inbox-recap:${key}`));
});
const recapsForWindow = Atom.family((key: string) => {
  const [ids, input] = JSON.parse(key) as [readonly EnvironmentId[], InboxRecapInput];
  return Atom.make((get) =>
    ids.map((environmentId) => get(recapForEnvironment(JSON.stringify([environmentId, input])))),
  );
});
export function useInboxRecaps(input: InboxRecapInput) {
  const catalog = useEnvironments();
  const ids = catalog.environments.map((environment) => environment.environmentId);
  const environments = useAtomValue(recapsForWindow(JSON.stringify([ids, input])));
  return { isReady: catalog.isReady, environments };
}
