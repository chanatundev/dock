// Adapted from Synara revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.

import { describe, expect, it } from "vite-plus/test";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { DraftId } from "./composerDraftStore";
import {
  addDockTab,
  buildDraftTabId,
  buildThreadTabId,
  closeDockTab,
  coordinateRouteTransition,
  findHiddenSurfaceTabIndexes,
  isSafeLocalHref,
  moveDockTab,
  normalizeDockTabRefs,
  parseDraftTabId,
  parseRouteToTabRef,
  parseThreadTabId,
  replaceDraftDockTab,
  shouldBootstrapDockThread,
  type DockTabRef,
} from "./dockTabs.logic";

describe("dockTabs.logic", () => {
  it("restores Code Review and discards removed GitHub Issues destinations", () => {
    const prs = parseRouteToTabRef({ pathname: "/pull-requests", search: {} });
    const issues = parseRouteToTabRef({ pathname: "/issues", search: { q: "Fix startup" } });
    expect(issues).toBeNull();
    expect(normalizeDockTabRefs([issues])).toEqual([]);
    expect(addDockTab([], prs!)).toEqual([prs]);
    expect(parseRouteToTabRef({ pathname: "/issues/thread-id" })).toBeNull();
  });

  it("restores legacy Hub entity URLs as the Spaces grouping view", () => {
    expect(
      parseRouteToTabRef({ pathname: "/hubs", search: { environmentId: "env", hubId: "old" } }),
    ).toEqual({ id: "hubs", kind: "hubs", href: "/hubs" });
    expect(
      normalizeDockTabRefs([
        { id: "hubs", kind: "hubs", href: "/hubs?environmentId=env&hubId=old" },
      ]),
    ).toMatchObject([{ id: "hubs", kind: "hubs", href: "/hubs" }]);
  });

  it("restores Inbox as one app view instead of interpreting it as a thread route", () => {
    const ref = parseRouteToTabRef({ pathname: "/inbox", search: {} });
    expect(ref).toEqual({ id: "inbox", kind: "inbox", href: "/inbox" });
    expect(normalizeDockTabRefs([ref])).toEqual([ref]);
    expect(parseRouteToTabRef({ pathname: "/inbox/thread-id", search: {} })).toBeNull();
  });
  it("does not reopen the server bootstrap thread after reloading the closed-views landing", () => {
    expect(shouldBootstrapDockThread({ pathname: "/", search: {} })).toBe(true);
    expect(shouldBootstrapDockThread({ pathname: "/usage", search: {} })).toBe(false);
    expect(shouldBootstrapDockThread({ pathname: "/", search: { dockTabsClosed: true } })).toBe(
      false,
    );
    expect(shouldBootstrapDockThread({ pathname: "/", search: { dockTabsClosed: false } })).toBe(
      true,
    );
  });
  it("does not manufacture a Home tab from the closed-views landing", () => {
    expect(parseRouteToTabRef({ pathname: "/", search: { dockTabsClosed: true } })).toBeNull();
    expect(parseRouteToTabRef({ pathname: "/", search: "?dockTabsClosed=true" })).toBeNull();
    expect(shouldBootstrapDockThread({ pathname: "/", search: "?dockTabsClosed=true" })).toBe(
      false,
    );
  });
  describe("multi-environment isolation and tuple encoding", () => {
    it("ensures the same ThreadId in two different environments does not collide", () => {
      const sharedThreadId = ThreadId.make("thread-123");
      const env1 = "env-local" as EnvironmentId;
      const env2 = "env-remote" as EnvironmentId;

      const id1 = buildThreadTabId(env1, sharedThreadId);
      const id2 = buildThreadTabId(env2, sharedThreadId);

      expect(id1).not.toBe(id2);
      expect(id1).toBe("thread:env-local:thread-123");
      expect(id2).toBe("thread:env-remote:thread-123");

      const tab1: DockTabRef = {
        id: id1,
        kind: "thread",
        environmentId: env1,
        threadId: sharedThreadId,
        href: `/${env1}/${sharedThreadId}`,
        title: "Thread Local",
      };

      const tab2: DockTabRef = {
        id: id2,
        kind: "thread",
        environmentId: env2,
        threadId: sharedThreadId,
        href: `/${env2}/${sharedThreadId}`,
        title: "Thread Remote",
      };

      let tabs: readonly DockTabRef[] = [];
      tabs = addDockTab(tabs, tab1);
      tabs = addDockTab(tabs, tab2);

      expect(tabs).toHaveLength(2);
      expect(tabs[0]?.id).toBe(id1);
      expect(tabs[1]?.id).toBe(id2);

      // Closing tab1 leaves tab2 intact
      const { tabs: afterClose } = closeDockTab(tabs, id1, id1);
      expect(afterClose).toHaveLength(1);
      expect(afterClose[0]?.id).toBe(id2);
      expect(afterClose[0]?.environmentId).toBe(env2);
    });

    it("prevents colon-concat collisions between env:a + b and env + a:b", () => {
      const envA = "env:a" as EnvironmentId;
      const threadB = ThreadId.make("b");
      const envNormal = "env" as EnvironmentId;
      const threadColon = ThreadId.make("a:b");

      const id1 = buildThreadTabId(envA, threadB);
      const id2 = buildThreadTabId(envNormal, threadColon);

      expect(id1).not.toBe(id2);
      expect(parseThreadTabId(id1)).toEqual({
        environmentId: envA,
        threadId: threadB,
      });
      expect(parseThreadTabId(id2)).toEqual({
        environmentId: envNormal,
        threadId: threadColon,
      });
    });

    it("safely encodes and round-trips thread IDs containing colons and special characters", () => {
      const env = "remote/cluster:1" as EnvironmentId;
      const threadId = ThreadId.make("provider:claude-3.5:session#99/1");

      const id = buildThreadTabId(env, threadId);
      const parsed = parseThreadTabId(id);

      expect(parsed).not.toBeNull();
      expect(parsed?.environmentId).toBe(env);
      expect(parsed?.threadId).toBe(threadId);
    });

    it("safely encodes and round-trips draft tab IDs", () => {
      const draftId = DraftId.make("draft/special:uuid-123");
      const id = buildDraftTabId(draftId);

      expect(parseDraftTabId(id)).toBe(draftId);
    });
  });

  describe("safe local href and persistence sanitization", () => {
    it("accepts valid local application hrefs", () => {
      expect(isSafeLocalHref("/")).toBe(true);
      expect(isSafeLocalHref("/pull-requests")).toBe(true);
      expect(isSafeLocalHref("/pull-requests?state=open&sort=newest")).toBe(true);
      expect(isSafeLocalHref("/usage")).toBe(true);
      expect(isSafeLocalHref("/settings")).toBe(true);
      expect(isSafeLocalHref("/settings/appearance?filter=dark")).toBe(true);
      expect(isSafeLocalHref("/env-1/thread-abc")).toBe(true);
      expect(isSafeLocalHref("/draft/draft-xyz")).toBe(true);
    });

    it("rejects external, protocol-relative, and dangerous scheme hrefs", () => {
      expect(isSafeLocalHref("https://malicious.com")).toBe(false);
      expect(isSafeLocalHref("http://example.com")).toBe(false);
      expect(isSafeLocalHref("//malicious.com/exploit")).toBe(false);
      expect(isSafeLocalHref("/\\malicious.com")).toBe(false);
      expect(isSafeLocalHref("javascript:alert(1)")).toBe(false);
      expect(isSafeLocalHref("data:text/html,<html>")).toBe(false);
      expect(isSafeLocalHref("blob:https://example.com/uuid")).toBe(false);
      expect(isSafeLocalHref(null)).toBe(false);
      expect(isSafeLocalHref(undefined)).toBe(false);
      expect(isSafeLocalHref(123)).toBe(false);
    });

    it("rejects auth, onboarding, and token-bearing hrefs", () => {
      expect(isSafeLocalHref("/pair")).toBe(false);
      expect(isSafeLocalHref("/connect")).toBe(false);
      expect(isSafeLocalHref("/connect-agent")).toBe(false);
      expect(isSafeLocalHref("/welcome")).toBe(false);
      expect(isSafeLocalHref("/pull-requests?token=secret123")).toBe(false);
      expect(isSafeLocalHref("/usage?secret=abc")).toBe(false);
      expect(isSafeLocalHref("/settings?auth=token")).toBe(false);
      expect(isSafeLocalHref("/env-1/thread-1?code=authorization_code")).toBe(false);
      expect(isSafeLocalHref("/env-1/thread-1?bearer=xyz")).toBe(false);
    });

    it("normalizes and sanitizes persisted tab data", () => {
      const raw = [
        null,
        "not an object",
        { id: "invalid-shape" },
        {
          id: buildThreadTabId("env-1" as EnvironmentId, ThreadId.make("th-1")),
          kind: "thread",
          href: "https://evil.com/hack", // external rejected
          environmentId: "env-1",
          threadId: "th-1",
        },
        {
          id: buildThreadTabId("env-1" as EnvironmentId, ThreadId.make("th-2")),
          kind: "thread",
          href: "/pair", // auth route rejected
          environmentId: "env-1",
          threadId: "th-2",
        },
        {
          id: buildThreadTabId("env-1" as EnvironmentId, ThreadId.make("th-3")),
          kind: "thread",
          href: "/env-1/th-3?token=secret", // token query rejected
          environmentId: "env-1",
          threadId: "th-3",
        },
        {
          id: buildThreadTabId("env-1" as EnvironmentId, ThreadId.make("th-valid")),
          kind: "thread",
          href: "/env-1/th-valid",
          environmentId: "env-1",
          threadId: "th-valid",
          title: "Valid Thread",
        },
        {
          id: buildDraftTabId(DraftId.make("draft-1")),
          kind: "draft",
          href: "/draft/draft-1",
          draftId: "draft-1",
          title: "Valid Draft",
        },
        {
          id: "pull-requests",
          kind: "pull-requests",
          href: "/pull-requests?state=open",
        },
        {
          id: "usage",
          kind: "usage",
          href: "/usage",
        },
        {
          id: "settings",
          kind: "settings",
          href: "/settings/general",
        },
        {
          id: "home",
          kind: "home",
          href: "/",
        },
        // Duplicate id is deduplicated
        {
          id: "usage",
          kind: "usage",
          href: "/usage",
        },
      ];

      const normalized = normalizeDockTabRefs(raw);
      expect(normalized).toHaveLength(6);
      expect(normalized.map((t) => t.id)).toEqual([
        buildThreadTabId("env-1" as EnvironmentId, ThreadId.make("th-valid")),
        buildDraftTabId(DraftId.make("draft-1")),
        "pull-requests",
        "usage",
        "settings",
        "home",
      ]);
    });

    it("rejects tabs with mismatched id/kind/href/entity refs", () => {
      const mismatchedCandidates = [
        // id does not match kind
        {
          id: "home",
          kind: "thread",
          environmentId: "env-1",
          threadId: "th-1",
          href: "/env-1/th-1",
        },
        // href does not match kind or entity ref
        {
          id: buildThreadTabId("env-1" as EnvironmentId, ThreadId.make("th-1")),
          kind: "thread",
          environmentId: "env-1",
          threadId: "th-1",
          href: "/settings",
        },
        // href points to different thread than entity refs
        {
          id: buildThreadTabId("env-1" as EnvironmentId, ThreadId.make("th-1")),
          kind: "thread",
          environmentId: "env-1",
          threadId: "th-1",
          href: "/env-2/th-2",
        },
        // draft id does not match draftId field
        {
          id: "draft:draft-alpha",
          kind: "draft",
          draftId: "draft-beta",
          href: "/draft/draft-beta",
        },
        // draft href does not match draftId
        {
          id: buildDraftTabId(DraftId.make("draft-alpha")),
          kind: "draft",
          draftId: "draft-alpha",
          href: "/draft/draft-different",
        },
        // pull-requests with wrong id
        {
          id: "pr-custom-id",
          kind: "pull-requests",
          href: "/pull-requests",
        },
        // pull-requests with wrong href
        {
          id: "pull-requests",
          kind: "pull-requests",
          href: "/usage",
        },
      ];

      const normalized = normalizeDockTabRefs(mismatchedCandidates);
      expect(normalized).toHaveLength(0);
    });

    it("canonicalizes valid refs and ensures all refs agree", () => {
      const env = "env-1" as EnvironmentId;
      const th = ThreadId.make("th-1");
      const validCandidates = [
        {
          id: buildThreadTabId(env, th),
          kind: "thread",
          environmentId: env,
          threadId: th,
          href: `/${env}/${th}`,
          title: "My Thread",
        },
        {
          id: "settings",
          kind: "settings",
          href: "/settings/keybindings?filter=tab",
        },
      ];

      const normalized = normalizeDockTabRefs(validCandidates);
      expect(normalized).toHaveLength(2);
      expect(normalized[0]?.id).toBe(buildThreadTabId(env, th));
      expect(normalized[0]?.href).toBe(`/${env}/${th}`);
      expect(normalized[0]?.environmentId).toBe(env);
      expect(normalized[0]?.threadId).toBe(th);
      expect(normalized[1]?.id).toBe("settings");
      expect(normalized[1]?.href).toBe("/settings/keybindings?filter=tab");
    });

    it("retains offline and archived threads across normalization without dropping them", () => {
      const offlineTabs: readonly DockTabRef[] = [
        {
          id: buildThreadTabId("env-offline" as EnvironmentId, ThreadId.make("th-archived")),
          kind: "thread",
          environmentId: "env-offline" as EnvironmentId,
          threadId: ThreadId.make("th-archived"),
          href: "/env-offline/th-archived",
          title: "Archived Offline Thread",
        },
      ];

      const normalized = normalizeDockTabRefs(offlineTabs);
      expect(normalized).toEqual(offlineTabs);
    });
  });

  describe("repeated open no-op and search query updates", () => {
    it("returns the exact same array reference when opening an identical tab", () => {
      const tab: DockTabRef = {
        id: "usage",
        kind: "usage",
        href: "/usage",
      };

      const initial = [tab];
      const result = addDockTab(initial, tab);
      expect(result).toBe(initial);
    });

    it("updates tab href in-place without changing order when search query changes", () => {
      const tab1: DockTabRef = {
        id: "pull-requests",
        kind: "pull-requests",
        href: "/pull-requests?state=open",
      };
      const tab2: DockTabRef = {
        id: "usage",
        kind: "usage",
        href: "/usage",
      };

      const initial = [tab1, tab2];
      const updatedTab1: DockTabRef = {
        id: "pull-requests",
        kind: "pull-requests",
        href: "/pull-requests?state=closed&involvement=reviewing",
      };

      const result = addDockTab(initial, updatedTab1);
      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe("pull-requests");
      expect(result[0]?.href).toBe("/pull-requests?state=closed&involvement=reviewing");
      expect(result[1]?.id).toBe("usage");
    });
  });

  describe("reorder (moveDockTab)", () => {
    const tabs: readonly DockTabRef[] = [
      { id: "tab-1", kind: "usage", href: "/usage" },
      { id: "tab-2", kind: "pull-requests", href: "/pull-requests" },
      { id: "tab-3", kind: "settings", href: "/settings" },
    ];

    it("moves a tab from start to middle", () => {
      const result = moveDockTab(tabs, "tab-1", "tab-2");
      expect(result.map((t) => t.id)).toEqual(["tab-2", "tab-1", "tab-3"]);
    });

    it("moves a tab from middle to end", () => {
      const result = moveDockTab(tabs, "tab-2", "tab-3");
      expect(result.map((t) => t.id)).toEqual(["tab-1", "tab-3", "tab-2"]);
    });

    it("moves a tab from end to start", () => {
      const result = moveDockTab(tabs, "tab-3", "tab-1");
      expect(result.map((t) => t.id)).toEqual(["tab-3", "tab-1", "tab-2"]);
    });

    it("returns original array unchanged when IDs are identical or not found", () => {
      expect(moveDockTab(tabs, "tab-1", "tab-1")).toBe(tabs);
      expect(moveDockTab(tabs, "tab-1", "non-existent")).toBe(tabs);
      expect(moveDockTab(tabs, "non-existent", "tab-1")).toBe(tabs);
    });
  });

  describe("close active / background / last tabs", () => {
    const tab1: DockTabRef = { id: "tab-1", kind: "usage", href: "/usage" };
    const tab2: DockTabRef = { id: "tab-2", kind: "pull-requests", href: "/pull-requests" };
    const tab3: DockTabRef = { id: "tab-3", kind: "settings", href: "/settings" };
    const initialTabs = [tab1, tab2, tab3];

    it("closing a background tab keeps current active target unchanged (nextTarget is null)", () => {
      const activeId = "tab-1";
      const { tabs, nextTarget } = closeDockTab(initialTabs, "tab-2", activeId);

      expect(tabs.map((t) => t.id)).toEqual(["tab-1", "tab-3"]);
      expect(nextTarget).toBeNull();
    });

    it("closing an active tab in the middle activates the tab sliding into its slot", () => {
      const activeId = "tab-2";
      const { tabs, nextTarget } = closeDockTab(initialTabs, "tab-2", activeId);

      expect(tabs.map((t) => t.id)).toEqual(["tab-1", "tab-3"]);
      expect(nextTarget).toEqual({ href: "/settings" });
    });

    it("closing the active tab at the end of the row activates the previous tab", () => {
      const activeId = "tab-3";
      const { tabs, nextTarget } = closeDockTab(initialTabs, "tab-3", activeId);

      expect(tabs.map((t) => t.id)).toEqual(["tab-1", "tab-2"]);
      expect(nextTarget).toEqual({ href: "/pull-requests" });
    });

    it("closing the last remaining tab returns home without starting another draft", () => {
      const singleTab = [tab1];
      const { tabs, nextTarget } = closeDockTab(singleTab, "tab-1", "tab-1");

      expect(tabs).toHaveLength(0);
      expect(nextTarget).toEqual({ href: "/?dockTabsClosed=true" });
    });
  });

  describe("overflow geometry (findHiddenSurfaceTabIndexes)", () => {
    it("identifies tabs whose geometry falls outside the visible strip boundaries", () => {
      const strip = { left: 100, right: 500 };
      const tabSpans = [
        { left: 100, right: 200 },
        { left: 205, right: 305 },
        { left: 310, right: 410 },
        { left: 415, right: 515 },
        { left: 520, right: 620 },
      ];

      const hidden = findHiddenSurfaceTabIndexes(strip, tabSpans);
      expect(hidden).toEqual([3, 4]);
    });
  });

  describe("route parsing and segment decoding (parseRouteToTabRef)", () => {
    it("parses pull requests route with search params preserved", () => {
      const parsed = parseRouteToTabRef({
        pathname: "/pull-requests",
        search: { state: "open", sort: "oldest" },
      });

      expect(parsed).not.toBeNull();
      expect(parsed?.id).toBe("pull-requests");
      expect(parsed?.kind).toBe("pull-requests");
      expect(parsed?.href).toBe("/pull-requests?state=open&sort=oldest");
    });

    it("parses settings subroutes and preserves query", () => {
      const parsed = parseRouteToTabRef({
        pathname: "/settings/appearance",
        search: "mode=preview",
      });

      expect(parsed).not.toBeNull();
      expect(parsed?.id).toBe("settings");
      expect(parsed?.kind).toBe("settings");
      expect(parsed?.href).toBe("/settings/appearance?mode=preview");
    });

    it("parses draft thread routes", () => {
      const parsed = parseRouteToTabRef({
        pathname: "/draft/draft-uuid-456",
      });

      expect(parsed).not.toBeNull();
      expect(parsed?.id).toBe(buildDraftTabId(DraftId.make("draft-uuid-456")));
      expect(parsed?.kind).toBe("draft");
      expect(parsed?.draftId).toBe(DraftId.make("draft-uuid-456"));
      expect(parsed?.href).toBe("/draft/draft-uuid-456");
    });

    it("parses environment-qualified server thread routes with URL segment decoding", () => {
      const parsed = parseRouteToTabRef({
        pathname: "/env%3Aremote/thread%23789",
      });

      expect(parsed).not.toBeNull();
      expect(parsed?.kind).toBe("thread");
      expect(parsed?.environmentId).toBe("env:remote");
      expect(parsed?.threadId).toBe("thread#789");
      expect(parsed?.id).toBe(
        buildThreadTabId("env:remote" as EnvironmentId, ThreadId.make("thread#789")),
      );
      expect(parsed?.href).toBe("/env%3Aremote/thread%23789");
    });

    it("rejects routes with extra path segments beyond /:environmentId/:threadId", () => {
      expect(parseRouteToTabRef({ pathname: "/env-1/thread-1/extra-segment" })).toBeNull();
    });

    it("returns null for auth/welcome pages", () => {
      expect(parseRouteToTabRef({ pathname: "/welcome" })).toBeNull();
      expect(parseRouteToTabRef({ pathname: "/pair" })).toBeNull();
      expect(parseRouteToTabRef({ pathname: "/connect" })).toBeNull();
    });
  });

  describe("coordinated route and draft transitions (coordinateRouteTransition)", () => {
    it("preserves tab slot when router batches ahead to server thread while draft tab is open", () => {
      const draftId = DraftId.make("draft-123");
      const serverRef = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("th-456"));
      const serverTabId = buildThreadTabId(serverRef.environmentId, serverRef.threadId);

      const initialTabs: readonly DockTabRef[] = [
        { id: "usage", kind: "usage", href: "/usage" },
        { id: buildDraftTabId(draftId), kind: "draft", draftId, href: `/draft/${draftId}` },
        { id: "settings", kind: "settings", href: "/settings" },
      ];

      // Route is already server thread route (router settled before store event or batched)
      const activeRoute: DockTabRef = {
        id: serverTabId,
        kind: "thread",
        environmentId: serverRef.environmentId,
        threadId: serverRef.threadId,
        href: `/${serverRef.environmentId}/${serverRef.threadId}`,
      };

      const result = coordinateRouteTransition({
        tabs: initialTabs,
        activeRoute,
        getPromotedDraftId: (ref) =>
          ref.environmentId === serverRef.environmentId && ref.threadId === serverRef.threadId
            ? draftId
            : null,
      });

      expect(result).toHaveLength(3);
      expect(result[0]?.id).toBe("usage");
      expect(result[1]?.id).toBe(serverTabId); // Preserved in-place at index 1!
      expect(result[1]?.kind).toBe("thread");
      expect(result[2]?.id).toBe("settings");
    });

    it("replaces draft in-place when active route is still draft and store promotes it", () => {
      const draftId = DraftId.make("draft-123");
      const serverRef = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("th-456"));
      const serverTabId = buildThreadTabId(serverRef.environmentId, serverRef.threadId);

      const initialTabs: readonly DockTabRef[] = [
        { id: buildDraftTabId(draftId), kind: "draft", draftId, href: `/draft/${draftId}` },
      ];

      const activeRoute: DockTabRef = {
        id: buildDraftTabId(draftId),
        kind: "draft",
        draftId,
        href: `/draft/${draftId}`,
      };

      const result = coordinateRouteTransition({
        tabs: initialTabs,
        activeRoute,
        getDraftPromotedTo: (id) => (id === draftId ? serverRef : null),
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(serverTabId);
    });

    it("does not re-add home tab when all tabs were closed and user navigated home", () => {
      const homeRoute: DockTabRef = { id: "home", kind: "home", href: "/" };
      const result = coordinateRouteTransition({
        tabs: [],
        activeRoute: homeRoute,
        isIntentionalHomeAfterCloseAll: true,
      });

      expect(result).toHaveLength(0);
    });
  });

  describe("draft-to-server promotion (replaceDraftDockTab)", () => {
    it("replaces draft tab in-place with promoted server thread", () => {
      const draftId = DraftId.make("draft-100");
      const initialTabs: readonly DockTabRef[] = [
        { id: "usage", kind: "usage", href: "/usage" },
        { id: buildDraftTabId(draftId), kind: "draft", draftId, href: `/draft/${draftId}` },
        { id: "settings", kind: "settings", href: "/settings" },
      ];

      const serverRef = scopeThreadRef(
        "env-1" as EnvironmentId,
        ThreadId.make("server-thread-999"),
      );

      const updated = replaceDraftDockTab(initialTabs, draftId, serverRef);

      expect(updated).toHaveLength(3);
      expect(updated[0]?.id).toBe("usage");
      expect(updated[1]?.id).toBe(
        buildThreadTabId("env-1" as EnvironmentId, ThreadId.make("server-thread-999")),
      );
      expect(updated[1]?.kind).toBe("thread");
      expect(updated[1]?.href).toBe("/env-1/server-thread-999");
      expect(updated[2]?.id).toBe("settings");
    });

    it("drops draft tab without duplicating if server tab is already present elsewhere", () => {
      const draftId = DraftId.make("draft-100");
      const serverRef = scopeThreadRef(
        "env-1" as EnvironmentId,
        ThreadId.make("server-thread-999"),
      );
      const serverTabId = buildThreadTabId(serverRef.environmentId, serverRef.threadId);

      const initialTabs: readonly DockTabRef[] = [
        {
          id: serverTabId,
          kind: "thread",
          ...serverRef,
          href: `/${serverRef.environmentId}/${serverRef.threadId}`,
        },
        { id: buildDraftTabId(draftId), kind: "draft", draftId, href: `/draft/${draftId}` },
      ];

      const updated = replaceDraftDockTab(initialTabs, draftId, serverRef);
      expect(updated).toHaveLength(1);
      expect(updated[0]?.id).toBe(serverTabId);
    });
  });
});

// Automations keeps its detail selection inside one persistent workspace tab.
it("restores the automation destination and selected environment/task", () => {
  expect(
    parseRouteToTabRef({
      pathname: "/automations",
      search: { environmentId: "env:a", taskId: "task:a" },
    }),
  ).toEqual({
    id: "automations",
    kind: "automations",
    href: "/automations?environmentId=env%3Aa&taskId=task%3Aa",
  });
});

it("restores the Automations workspace and its selected record", () => {
  const tab = parseRouteToTabRef({
    pathname: "/automations",
    search: "?environmentId=env&taskId=schedule",
  });
  expect(tab).not.toBeNull();
  expect(normalizeDockTabRefs([tab])).toEqual([tab]);
});

it("restores legacy Hubs entity links without their deleted selection", () => {
  const tab = parseRouteToTabRef({ pathname: "/hubs", search: "?environmentId=env&hubId=hub" });
  expect(tab).toEqual({ id: "hubs", kind: "hubs", href: "/hubs" });
  expect(normalizeDockTabRefs([tab])).toEqual([tab]);
});
