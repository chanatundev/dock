import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  UsageLimitSourceId,
  type ServerProvider,
  type ServerProviderUsageWindow,
  type UsageLimitSourceSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { LimitPresentations } from "@t3tools/shared/usageLimits";
import {
  buildDockProviderShowcaseAccounts,
  normalizeDockProviderSelections,
} from "./dockProviderShowcase.logic.ts";

type Presentation =
  LimitPresentations extends ReadonlyMap<EnvironmentId, infer Value> ? Value : never;

const claude = ProviderDriverKind.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");
const sessionWindow = (id: string, usedPercent: number): ServerProviderUsageWindow => ({
  id,
  kind: "session",
  label: id,
  usedPercent,
  windowDurationMins: 300,
  resetsAt: "2026-10-27T15:00:00.000Z",
});

function provider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("default"),
    driver: claude,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-27T10:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

function presentation(
  label: string,
  providers: readonly ServerProvider[] = [],
  usageLimitSources: readonly UsageLimitSourceSnapshot[] = [],
): Presentation {
  return {
    entry: { target: { label } },
    serverConfig: { providers, usageLimitSources },
  };
}

function usageSource(
  accounts: UsageLimitSourceSnapshot["accounts"],
  id = "hub",
): UsageLimitSourceSnapshot {
  return {
    id: UsageLimitSourceId.make(id),
    kind: "cliproxy",
    label: "Hub",
    checkedAt: "2026-10-27T10:00:00.000Z",
    accounts,
  };
}

function accountByEmail(email: string, presentations: LimitPresentations) {
  return buildDockProviderShowcaseAccounts(presentations, new Set()).find(
    (account) => account.email?.toLowerCase() === email.toLowerCase(),
  );
}

describe("Dock provider showcase accounts", () => {
  it("groups matching emails and credential fingerprints across environments", () => {
    const sameEmail = (instanceId: string) =>
      provider({
        instanceId: ProviderInstanceId.make(instanceId),
        auth: { status: "authenticated", email: "Same@Example.com" },
        usageLimits: {
          checkedAt: "2026-10-27T10:00:00.000Z",
          windows: [sessionWindow("email", 25)],
        },
      });
    const sameFingerprint = (instanceId: string) =>
      provider({
        instanceId: ProviderInstanceId.make(instanceId),
        driver: codex,
        auth: { status: "authenticated" },
        usageLimits: {
          checkedAt: "2026-10-27T10:00:00.000Z",
          credentialFingerprint: "fingerprint-1",
          windows: [sessionWindow("fingerprint", 40)],
        },
      });
    const presentations = new Map([
      [
        EnvironmentId.make("env-a"),
        presentation("Laptop", [sameEmail("email-a"), sameFingerprint("fingerprint-a")]),
      ],
      [
        EnvironmentId.make("env-b"),
        presentation("Desktop", [sameEmail("email-b"), sameFingerprint("fingerprint-b")]),
      ],
    ]);

    const accounts = buildDockProviderShowcaseAccounts(presentations, new Set());

    expect(accounts).toHaveLength(2);
    expect(accountByEmail("same@example.com", presentations)).toMatchObject({
      selectionKey: "claudeAgent:same@example.com",
      members: [
        { environmentLabel: "Laptop", connected: false },
        { environmentLabel: "Desktop", connected: false },
      ],
    });
    expect(accounts.find((account) => account.driver === codex)).toMatchObject({
      selectionKey: "codex:credential:fingerprint-1",
      members: [
        { environmentId: EnvironmentId.make("env-a") },
        { environmentId: EnvironmentId.make("env-b") },
      ],
    });
  });

  it("keeps known workspaces distinct and scopes ambiguous workspace-less logins", () => {
    const login = (instanceId: string, workspaceId?: string) =>
      provider({
        instanceId: ProviderInstanceId.make(instanceId),
        auth: { status: "authenticated", email: "same@example.com", workspaceId },
      });
    const envA = EnvironmentId.make("env-a");
    const envB = EnvironmentId.make("env-b");
    const presentations = new Map([
      [
        envA,
        presentation("Laptop", [
          login("business-a", "workspace-a"),
          login("business-b", "workspace-b"),
        ]),
      ],
      [envB, presentation("Desktop", [login("ambiguous")])],
    ]);

    const accounts = buildDockProviderShowcaseAccounts(presentations, new Set());

    expect(accounts).toHaveLength(3);
    expect(accounts.map((account) => account.selectionKey).sort()).toEqual(
      [
        "claudeAgent:same@example.com:workspace-a",
        "claudeAgent:same@example.com:workspace-b",
        JSON.stringify(["provider", envB, claude, "ambiguous"]),
      ].sort(),
    );
    expect(
      accounts.find(
        (account) =>
          account.selectionKey === JSON.stringify(["provider", envB, claude, "ambiguous"]),
      )?.members,
    ).toEqual([
      {
        kind: "provider",
        instanceId: ProviderInstanceId.make("ambiguous"),
        environmentId: envB,
        environmentLabel: "Desktop",
        connected: false,
      },
    ]);
  });

  it("retains disconnected and unavailable members without adding disabled providers", () => {
    const disconnectedId = EnvironmentId.make("disconnected");
    const connectedId = EnvironmentId.make("connected");
    const disconnectedLogin = provider({
      instanceId: ProviderInstanceId.make("laptop-login"),
      auth: { status: "authenticated", email: "shared@example.com" },
      displayName: "Laptop login",
      usageLimits: {
        checkedAt: "2026-10-27T10:00:00.000Z",
        windows: [],
        unavailable: { reason: "probeFailed" },
      },
    });
    const connectedLogin = provider({
      instanceId: ProviderInstanceId.make("desktop-login"),
      auth: { status: "authenticated", email: "shared@example.com" },
      usageLimits: {
        checkedAt: "2026-10-27T10:30:00.000Z",
        windows: [sessionWindow("healthy", 35)],
      },
    });
    const unavailable = provider({
      instanceId: ProviderInstanceId.make("unsupported"),
      auth: { status: "authenticated", email: "unsupported@example.com" },
      usageLimits: {
        checkedAt: "2026-10-27T10:00:00.000Z",
        windows: [],
        unavailable: { reason: "unsupported" },
      },
    });
    const disabled = provider({ instanceId: ProviderInstanceId.make("disabled"), enabled: false });
    const source = usageSource([
      {
        id: "source-only.json",
        driver: codex,
        usageLimits: {
          checkedAt: "2026-10-27T10:00:00.000Z",
          windows: [],
          unavailable: { reason: "probeFailed" },
        },
      },
    ]);
    const presentations = new Map([
      [disconnectedId, presentation("Old laptop", [disconnectedLogin], [source])],
      [connectedId, presentation("Desktop", [connectedLogin, unavailable, disabled])],
    ]);

    const accounts = buildDockProviderShowcaseAccounts(presentations, new Set([connectedId]));
    const shared = accounts.find((account) => account.email === "shared@example.com");
    const unavailableAccount = accounts.find(
      (account) => account.email === "unsupported@example.com",
    );
    const sourceOnly = accounts.find((account) => account.driver === codex);

    expect(accounts).toHaveLength(3);
    expect(shared).toMatchObject({
      displayName: "Laptop login",
      usageLimits: { windows: [sessionWindow("healthy", 35)] },
    });
    expect(shared?.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ environmentLabel: "Old laptop", connected: false }),
        expect.objectContaining({ environmentLabel: "Desktop", connected: true }),
      ]),
    );
    expect(unavailableAccount).toMatchObject({ usageLimits: null });
    expect(sourceOnly?.members).toEqual([
      {
        kind: "usageLimitSource",
        sourceId: UsageLimitSourceId.make("hub"),
        accountId: "source-only.json",
        sourceLabel: "Hub",
        environmentId: disconnectedId,
        environmentLabel: "Old laptop",
        connected: false,
      },
    ]);
    expect(
      accounts
        .flatMap((account) => account.members)
        .some(
          (member) =>
            member.kind === "provider" && member.instanceId === ProviderInstanceId.make("disabled"),
        ),
    ).toBe(false);
  });

  it("keeps unknown native and source identities environment-scoped and collision-safe", () => {
    const native = (instanceId: string) =>
      provider({ instanceId: ProviderInstanceId.make(instanceId), driver: codex });
    const source = usageSource([
      {
        id: "same",
        driver: codex,
        usageLimits: {
          checkedAt: "2026-10-27T10:00:00.000Z",
          windows: [sessionWindow("source", 10)],
        },
      },
      {
        id: "same",
        driver: claude,
        usageLimits: {
          checkedAt: "2026-10-27T10:00:00.000Z",
          windows: [sessionWindow("source-claude", 15)],
        },
      },
    ]);
    const envA = EnvironmentId.make("env-a");
    const envB = EnvironmentId.make("env-b");
    const presentations = new Map([
      [envA, presentation("Laptop", [native("same")], [source])],
      [envB, presentation("Desktop", [native("same")], [source])],
    ]);

    const accounts = buildDockProviderShowcaseAccounts(presentations, new Set());

    expect(accounts.map((account) => account.selectionKey).sort()).toEqual(
      [
        JSON.stringify(["provider", envA, codex, "same"]),
        JSON.stringify(["source", envA, codex, UsageLimitSourceId.make("hub"), "same"]),
        JSON.stringify(["source", envA, claude, UsageLimitSourceId.make("hub"), "same"]),
        JSON.stringify(["provider", envB, codex, "same"]),
        JSON.stringify(["source", envB, codex, UsageLimitSourceId.make("hub"), "same"]),
        JSON.stringify(["source", envB, claude, UsageLimitSourceId.make("hub"), "same"]),
      ].sort(),
    );
    expect(new Set(accounts.map((account) => account.selectionKey)).size).toBe(6);
  });

  it("uses the freshest healthy quota report and never borrows a sibling account's windows", () => {
    const email = (
      instanceId: string,
      address: string,
      checkedAt: string,
      windows: readonly ServerProviderUsageWindow[],
      unavailable?: "probeFailed" | "unsupported",
    ) =>
      provider({
        instanceId: ProviderInstanceId.make(instanceId),
        auth: { status: "authenticated", email: address },
        usageLimits: {
          checkedAt,
          windows,
          ...(unavailable ? { unavailable: { reason: unavailable } } : {}),
        },
      });
    const envA = EnvironmentId.make("env-a");
    const envB = EnvironmentId.make("env-b");
    const envC = EnvironmentId.make("env-c");
    const envD = EnvironmentId.make("env-d");
    const presentations = new Map([
      [
        envA,
        presentation("Laptop", [
          email("account-a", "same@example.com", "2026-10-27T10:00:00.000Z", [
            sessionWindow("old", 20),
          ]),
          email(
            "unavailable",
            "unavailable@example.com",
            "2026-10-27T10:00:00.000Z",
            [],
            "probeFailed",
          ),
          email("other", "other@example.com", "2026-10-27T10:00:00.000Z", [
            sessionWindow("other", 80),
          ]),
        ]),
      ],
      [
        envB,
        presentation(
          "Hub",
          [],
          [
            usageSource([
              {
                id: "same.json",
                driver: claude,
                email: "same@example.com",
                usageLimits: {
                  checkedAt: "2026-10-27T11:00:00.000Z",
                  windows: [sessionWindow("fresh-healthy", 45)],
                },
              },
            ]),
          ],
        ),
      ],
      [
        envC,
        presentation("Desktop", [
          email(
            "account-c",
            "same@example.com",
            "2026-10-27T12:00:00.000Z",
            [sessionWindow("failed-read", 99)],
            "probeFailed",
          ),
        ]),
      ],
      [
        envD,
        presentation("Server", [
          email("newer-other", "other@example.com", "2026-10-27T13:00:00.000Z", [
            sessionWindow("other", 80),
          ]),
        ]),
      ],
    ]);

    const accounts = buildDockProviderShowcaseAccounts(presentations, new Set());
    const same = accounts.find((account) => account.email === "same@example.com");
    const unavailable = accounts.find((account) => account.email === "unavailable@example.com");
    const other = accounts.find((account) => account.email === "other@example.com");

    expect(same?.usageLimits).toEqual({
      checkedAt: "2026-10-27T11:00:00.000Z",
      windows: [sessionWindow("fresh-healthy", 45)],
    });
    expect(unavailable?.usageLimits).toBeNull();
    expect(other?.usageLimits).toEqual({
      checkedAt: "2026-10-27T13:00:00.000Z",
      windows: [sessionWindow("other", 80)],
    });
  });

  it("produces the same selection keys and ordering when presentations are reordered", () => {
    const envA = EnvironmentId.make("env-a");
    const envB = EnvironmentId.make("env-b");
    const presentations = new Map([
      [
        envA,
        presentation("Laptop", [
          provider({
            instanceId: ProviderInstanceId.make("second"),
            auth: { status: "authenticated", email: "z@example.com" },
          }),
          provider({
            instanceId: ProviderInstanceId.make("first"),
            auth: { status: "authenticated", email: "a@example.com" },
          }),
        ]),
      ],
      [
        envB,
        presentation("Desktop", [provider({ instanceId: ProviderInstanceId.make("unknown") })]),
      ],
    ]);
    const reversed = new Map(
      [...presentations].toReversed().map(([id, value]) => [
        id,
        {
          ...value,
          serverConfig: {
            ...value.serverConfig!,
            providers: [...value.serverConfig!.providers].toReversed(),
          },
        },
      ]),
    );

    expect(buildDockProviderShowcaseAccounts(presentations, new Set())).toEqual(
      buildDockProviderShowcaseAccounts(reversed, new Set()),
    );
  });
});

describe("normalizeDockProviderSelections", () => {
  it("keeps every ordered valid selection, including unavailable identities", () => {
    expect(
      normalizeDockProviderSelections([
        null,
        "",
        "   ",
        "x".repeat(2049),
        "unavailable-account",
        "available-account",
        "unavailable-account",
        "third-account",
      ]),
    ).toEqual(["unavailable-account", "available-account", "third-account"]);
  });

  it("returns no selections for non-array persisted values", () => {
    expect(normalizeDockProviderSelections({ selection: "account" })).toEqual([]);
    expect(normalizeDockProviderSelections(null)).toEqual([]);
  });
});
