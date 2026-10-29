import { useAtomValue } from "@effect/atom-react";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { appAtomRegistry } from "../../state/atom-registry";
import { serverEnvironment } from "../../state/server";

export function useSidechatViewLease(
  environmentId: EnvironmentId,
  threadId: ThreadId,
  enabled: boolean,
) {
  const focused = useIsFocused();
  const supported =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.environment.capabilities
      .dockSidechatViews === true;
  const [foreground, setForeground] = useState(() => AppState.currentState === "active");

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    // oxlint-disable-next-line react/set-state-in-effect -- Syncs state the listener could have missed.
    setForeground(AppState.currentState === "active");
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!enabled || !supported || !focused || !foreground) return;
    return appAtomRegistry.mount(
      serverEnvironment.sidechatView({ environmentId, input: { threadId } }),
    );
  }, [enabled, environmentId, focused, foreground, supported, threadId]);
}
