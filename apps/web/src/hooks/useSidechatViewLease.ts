import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";

export function useSidechatViewLease(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  enabled: boolean,
) {
  const supported =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.environment.capabilities
      .dockSidechatViews === true;
  useEffect(() => {
    if (!enabled || !supported) return;
    const view = serverEnvironment.sidechatView({ environmentId, input: { threadId } });
    let release: (() => void) | undefined;
    const synchronize = () => {
      if (document.visibilityState === "visible") release ??= appAtomRegistry.mount(view);
      else {
        release?.();
        release = undefined;
      }
    };
    synchronize();
    document.addEventListener("visibilitychange", synchronize);
    return () => {
      document.removeEventListener("visibilitychange", synchronize);
      release?.();
    };
  }, [environmentId, threadId, enabled, supported]);
}
