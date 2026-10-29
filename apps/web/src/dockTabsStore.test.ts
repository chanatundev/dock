// Adapted from Synara revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.

import { describe, expect, it } from "vite-plus/test";
import { createJSONStorage } from "zustand/middleware";
import { createMemoryStorage } from "./lib/storage";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { DraftId } from "./composerDraftStore";
import { buildDraftTabId, buildThreadTabId, type DockTabRef } from "./dockTabs.logic";
import { DOCK_TOP_TABS_STORAGE_KEY, resolveSafeStorage, useDockTabsStore } from "./dockTabsStore";

describe("dockTabsStore", () => {
  it("validates current-version storage during hydration and restores ordered offline references", async () => {
    const options = useDockTabsStore.persist.getOptions();
    const previous = useDockTabsStore.getState();
    using _restore = {
      [Symbol.dispose]: () => {
        useDockTabsStore.persist.setOptions(options);
        useDockTabsStore.setState(previous, true);
      },
    };
    const storage = createMemoryStorage();
    const offline = {
      id: buildThreadTabId(EnvironmentId.make("offline"), ThreadId.make("thread:1")),
      kind: "thread",
      environmentId: "offline",
      threadId: "thread:1",
      href: "/offline/thread%3A1",
    };
    storage.setItem(
      DOCK_TOP_TABS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          tabs: [
            { id: "usage", kind: "usage", href: "/usage" },
            { id: "settings", kind: "usage", href: "/settings" },
            offline,
            { id: "home", kind: "home", href: "/pair?token=private" },
          ],
          openTab: "invalid action from storage",
        },
      }),
    );
    useDockTabsStore.persist.setOptions({ storage: createJSONStorage(() => storage) });
    await useDockTabsStore.persist.rehydrate();
    expect(useDockTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(["usage", offline.id]);
    expect(typeof useDockTabsStore.getState().openTab).toBe("function");
  });
  it("keeps view changes in memory when storage can be read but cannot be written", () => {
    const storage = resolveSafeStorage({ getItem: () => "saved layout" });
    expect(storage.getItem("tabs")).toBe("saved layout");
    storage.setItem("tabs", "changed layout");
    expect(storage.getItem("tabs")).toBe("changed layout");
    storage.removeItem("tabs");
    expect(storage.getItem("tabs")).toBeNull();
  });
  it("does not restore a removed value when backing storage rejects the removal", () => {
    const storage = resolveSafeStorage({
      getItem: () => "previously saved",
      removeItem: () => {
        throw new Error("Storage blocked");
      },
    });
    expect(storage.getItem("tabs")).toBe("previously saved");
    storage.removeItem("tabs");
    expect(storage.getItem("tabs")).toBeNull();
  });
  it("does not generate test writes on startup probe", () => {
    const writtenKeys: string[] = [];
    const mockStorage = {
      getItem: () => null,
      setItem: (key: string) => {
        writtenKeys.push(key);
      },
      removeItem: () => {},
    };

    resolveSafeStorage(mockStorage);
    expect(writtenKeys).toHaveLength(0);
  });

  it("falls back gracefully and preserves readable data when setItem throws QuotaExceededError", () => {
    const rawData = JSON.stringify({
      state: {
        tabs: [
          {
            id: "usage",
            kind: "usage",
            href: "/usage",
          },
        ],
      },
      version: 1,
    });

    const quotaExceededStorage = {
      getItem: (key: string) => (key === "test-key" ? rawData : null),
      setItem: () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
      removeItem: () => {},
    };

    const storage = resolveSafeStorage(quotaExceededStorage);
    expect(storage).toBeDefined();

    // Initial read succeeds from backing storage
    expect(storage.getItem("test-key")).toBe(rawData);

    // Write should not crash the app even when quota is exceeded
    expect(() => {
      storage.setItem("test-key", "new-value");
    }).not.toThrow();

    // Subsequent read returns the latest written value from memory fallback
    expect(storage.getItem("test-key")).toBe("new-value");
  });

  it("falls back gracefully to in-memory storage when storage access throws SecurityError", () => {
    const throwingStorage = {
      getItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    };

    const storage = resolveSafeStorage(throwingStorage);
    expect(storage).toBeDefined();

    // Verify it functions in memory without throwing
    storage.setItem("key", "val");
    expect(storage.getItem("key")).toBe("val");
    storage.removeItem("key");
    expect(storage.getItem("key")).toBeNull();
  });

  it("handles opening, reordering, draft promotion, and deterministic closing", () => {
    useDockTabsStore.getState().clearTabs();

    const env = "env-1" as EnvironmentId;
    const th1 = ThreadId.make("thread-1");
    const th2 = ThreadId.make("thread-2");
    const draft1 = DraftId.make("draft-1");

    const tab1: DockTabRef = {
      id: buildThreadTabId(env, th1),
      kind: "thread",
      environmentId: env,
      threadId: th1,
      href: `/${env}/${th1}`,
      title: "Thread 1",
    };

    const tab2: DockTabRef = {
      id: "pull-requests",
      kind: "pull-requests",
      href: "/pull-requests",
    };

    const tab3: DockTabRef = {
      id: buildDraftTabId(draft1),
      kind: "draft",
      draftId: draft1,
      href: `/draft/${draft1}`,
    };

    // Open tabs
    useDockTabsStore.getState().openTab(tab1);
    useDockTabsStore.getState().openTab(tab2);
    useDockTabsStore.getState().openTab(tab3);

    expect(useDockTabsStore.getState().tabs).toHaveLength(3);

    // Reorder tabs: move tab3 to position of tab1
    useDockTabsStore.getState().moveTab(tab3.id, tab1.id);
    expect(useDockTabsStore.getState().tabs.map((t) => t.id)).toEqual([tab3.id, tab1.id, tab2.id]);

    // Promote draft3 to server thread-2
    const serverRef2 = scopeThreadRef(env, th2);
    useDockTabsStore.getState().promoteDraft(draft1, serverRef2);

    const promotedTabId = buildThreadTabId(env, th2);
    expect(useDockTabsStore.getState().tabs.map((t) => t.id)).toEqual([
      promotedTabId,
      tab1.id,
      tab2.id,
    ]);

    // Close background tab (tab1 while active is promotedTabId)
    const bgCloseResult = useDockTabsStore.getState().closeTab(tab1.id, promotedTabId);
    expect(bgCloseResult).toBeNull();
    expect(useDockTabsStore.getState().tabs.map((t) => t.id)).toEqual([promotedTabId, tab2.id]);

    // Close active tab in slot 0 (promotedTabId while active is promotedTabId) -> slides to tab2
    const activeCloseResult = useDockTabsStore.getState().closeTab(promotedTabId, promotedTabId);
    expect(activeCloseResult).toEqual({ href: "/pull-requests" });
    expect(useDockTabsStore.getState().tabs.map((t) => t.id)).toEqual([tab2.id]);

    // Close last remaining tab -> returns home route ("/")
    const lastCloseResult = useDockTabsStore.getState().closeTab(tab2.id, tab2.id);
    expect(lastCloseResult).toEqual({ href: "/?dockTabsClosed=true" });
    expect(useDockTabsStore.getState().tabs).toHaveLength(0);
  });
});
