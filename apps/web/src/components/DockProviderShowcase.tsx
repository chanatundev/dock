// Account showcase adapted from Synara revision 3f55b77ef186764050ecf4edd6ae0879eec948a8.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import { useAtomValue } from "@effect/atom-react";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import { remainingPercent } from "@t3tools/shared/usageLimits";
import { Link } from "@tanstack/react-router";
import { GaugeIcon } from "lucide-react";
import { useEffect, useEffectEvent } from "react";

import {
  buildDockProviderShowcaseAccounts,
  type DockProviderShowcaseAccount,
} from "../dockProviderShowcase.logic";
import { useDockProviderShowcaseStore } from "../dockProviderShowcaseStore";
import { useNowMinute } from "../hooks/useNowMinute";
import { cn } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useConnectedEnvironmentIds } from "../state/environments";
import { environmentPresentations } from "../state/presentation";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "./ui/preview-card";

function accountLabel(account: DockProviderShowcaseAccount) {
  return [account.displayName ?? account.driver, account.email].filter(Boolean).join(" · ");
}

function AccountRing({ account }: { account: DockProviderShowcaseAccount | undefined }) {
  const windows = account?.usageLimits?.windows ?? [];
  const constrained = windows.toSorted((a, b) => remainingPercent(a) - remainingPercent(b))[0];
  const remaining = constrained === undefined ? null : remainingPercent(constrained);
  const label = account ? accountLabel(account) : "Account unavailable";
  const online = account?.members.some((member) => member.connected) === true;
  return (
    <PreviewCard>
      <PreviewCardTrigger
        render={
          <Link
            to="/usage"
            aria-label={`${label}: ${remaining === null ? "quota unavailable" : `${remaining}% remaining in ${constrained?.label}`}${online ? "" : ", offline"}`}
            className="relative grid size-10 shrink-0 place-items-center rounded-lg outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 40 40"
          className={cn("absolute inset-0 size-10", !online && "opacity-50")}
        >
          <circle
            cx="20"
            cy="20"
            r="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-muted-foreground/20"
          />
          <circle
            cx="20"
            cy="20"
            r="17"
            pathLength="100"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={remaining === null ? "2 6" : `${remaining} 100`}
            transform="rotate(-90 20 20)"
            className={
              remaining === null
                ? "text-muted-foreground"
                : remaining <= 10
                  ? "text-destructive"
                  : remaining <= 25
                    ? "text-warning"
                    : "text-success"
            }
          />
        </svg>
        {account ? (
          <ProviderInstanceIcon
            driverKind={account.driver}
            displayName={account.displayName ?? account.driver}
            size="compact"
            showBadge={false}
          />
        ) : (
          <GaugeIcon className="size-4 text-muted-foreground" />
        )}
      </PreviewCardTrigger>
      <PreviewCardPopup side="right">
        <div className="w-72 space-y-3 p-3 text-sm">
          <p className="break-words font-medium">{label}</p>
          {account?.usageLimits ? (
            <>
              <ul className="space-y-1">
                {windows.map((window) => (
                  <li key={window.id} className="flex justify-between gap-3">
                    <span>{window.label}</span>
                    <span>{remainingPercent(window)}% remaining</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Last reported {new Date(account.usageLimits.checkedAt).toLocaleString()}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Quota unavailable</p>
          )}
          <ul className="space-y-1 text-xs text-muted-foreground">
            {account?.members.map((member) => (
              <li key={JSON.stringify(member)}>
                {member.environmentLabel}
                {member.kind === "usageLimitSource" ? ` · ${member.sourceLabel}` : ""} ·{" "}
                {member.connected ? "Connected" : "Offline"}
              </li>
            ))}
          </ul>
          <Link className="text-xs underline" to="/usage">
            View usage
          </Link>
        </div>
      </PreviewCardPopup>
    </PreviewCard>
  );
}

export function DockProviderShowcase({ layout = "row" }: { layout?: "row" | "rail" }) {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const connectedIds = useConnectedEnvironmentIds();
  const accounts = buildDockProviderShowcaseAccounts(presentations, new Set(connectedIds));
  const selectedKeys = useDockProviderShowcaseStore((state) => state.selectedKeys);
  const setSelectedKeys = useDockProviderShowcaseStore((state) => state.setSelectedKeys);
  const minute = useNowMinute();
  const refresh = useAtomCommand(serverEnvironment.refreshProviders, { reportFailure: false });
  const selectedEnvironmentKey = JSON.stringify(
    [
      ...new Set(
        accounts
          .filter((account) => selectedKeys.includes(account.selectionKey))
          .flatMap((account) =>
            account.members
              .filter((member) => member.connected)
              .map((member) => member.environmentId),
          ),
      ),
    ].sort(),
  );
  const refreshSelected = useEffectEvent(() => {
    if (document.visibilityState !== "visible") return;
    const selectedEnvironments = new Set(
      accounts
        .filter((account) => selectedKeys.includes(account.selectionKey))
        .flatMap((account) =>
          account.members
            .filter((member) => member.connected)
            .map((member) => member.environmentId),
        ),
    );
    void Promise.all(
      [...selectedEnvironments].map((environmentId) => {
        if (
          appAtomRegistry.get(serverEnvironment.refreshProviders.permissionAtom(environmentId)) !==
          true
        )
          return;
        return refreshUsageLimits(environmentId, () => refresh({ environmentId, input: {} }), true);
      }),
    ).catch(() => undefined);
  });
  useEffect(() => {
    if (minute && selectedEnvironmentKey !== "[]") refreshSelected();
  }, [minute, selectedEnvironmentKey]);
  useEffect(() => {
    const onVisibility = () => refreshSelected();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const missingKeys = selectedKeys.filter(
    (key) => !accounts.some((account) => account.selectionKey === key),
  );
  return (
    <div
      aria-label="Provider account showcase"
      className={cn(
        "flex items-center gap-1 [scrollbar-width:none]",
        layout === "rail"
          ? "max-h-full min-h-0 flex-col overflow-y-auto"
          : "max-w-full overflow-x-auto",
      )}
    >
      {selectedKeys.map((key) => (
        <AccountRing key={key} account={accounts.find((account) => account.selectionKey === key)} />
      ))}
      <Popover>
        <PopoverTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="Choose showcase accounts" />}
        >
          <GaugeIcon className="size-4" />
        </PopoverTrigger>
        <PopoverPopup width="md" side={layout === "rail" ? "right" : "bottom"} align="end">
          <div className="space-y-3">
            <p className="text-sm font-medium">Provider account showcase</p>
            <p className="text-xs text-muted-foreground">
              Choose the accounts for this client's rail. Matching accounts share a ring across
              environments.
            </p>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {accounts.map((account) => (
                <label
                  key={account.selectionKey}
                  className="flex cursor-pointer items-start gap-2 text-sm"
                >
                  <Checkbox
                    aria-label={accountLabel(account)}
                    checked={selectedKeys.includes(account.selectionKey)}
                    onCheckedChange={(checked) =>
                      setSelectedKeys(
                        checked
                          ? [...selectedKeys, account.selectionKey]
                          : selectedKeys.filter((key) => key !== account.selectionKey),
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="block break-words">{accountLabel(account)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[
                        ...new Set(
                          account.members.map(
                            (member) =>
                              `${member.environmentLabel}${member.connected ? "" : " (offline)"}`,
                          ),
                        ),
                      ].join(", ")}
                      {account.usageLimits === null ? " · Quota unavailable" : ""}
                    </span>
                  </span>
                </label>
              ))}
              {missingKeys.map((key, index) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    aria-label={`Remove unavailable account ${index + 1}`}
                    checked
                    onCheckedChange={() =>
                      setSelectedKeys(selectedKeys.filter((selected) => selected !== key))
                    }
                  />
                  <span>Account unavailable</span>
                </label>
              ))}
              {accounts.length === 0 && missingKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Connect an environment with a provider account to choose its ring.
                </p>
              ) : null}
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
