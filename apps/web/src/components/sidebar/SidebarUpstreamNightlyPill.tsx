import { useEffect, useState } from "react";

import { APP_VERSION } from "../../branding";
import { fetchNewerUpstreamNightly, upstreamNightlyReleaseUrl } from "../../upstreamNightly";
import { SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { DesktopUpdateStatusIcon } from "./DesktopUpdateStatusIcon";

const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;

function useNewerUpstreamNightly(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // A failed check keeps the last answer; the next interval retries.
    const check = () =>
      fetchNewerUpstreamNightly(APP_VERSION, controller.signal).then(setVersion, () => {});
    void check();
    const interval = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  return version;
}

/**
 * dock's stand-in for the desktop update pill. dock publishes no update
 * feed; it is rebuilt after merging upstream nightlies, so this only points
 * at the upstream nightly that a sync would bring in.
 */
export function SidebarUpstreamNightlyPill() {
  const version = useNewerUpstreamNightly();
  if (!version) return null;

  const tooltip = `T3 Code nightly ${version} is available. Run update-dock-from-t3code to merge it.`;
  const releaseUrl = upstreamNightlyReleaseUrl(version);

  return (
    <SidebarMenuItem className="ml-auto shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={tooltip}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-sidebar-control-surface text-sidebar-foreground outline-hidden ring-ring transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2"
              onClick={() => {
                if (window.desktopBridge) void window.desktopBridge.openExternal(releaseUrl);
                else window.open(releaseUrl, "_blank", "noopener,noreferrer");
              }}
            >
              <DesktopUpdateStatusIcon status="available" />
            </button>
          }
        />
        <TooltipPopup align="center" side="top" variant="glass">
          {tooltip}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
