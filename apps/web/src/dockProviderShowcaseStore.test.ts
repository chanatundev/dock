import { describe, expect, it } from "vite-plus/test";
import { createJSONStorage } from "zustand/middleware";

import { createMemoryStorage } from "./lib/storage";
import {
  DOCK_PROVIDER_SHOWCASE_STORAGE_KEY,
  useDockProviderShowcaseStore,
} from "./dockProviderShowcaseStore";

describe("provider showcase profile", () => {
  it("restores every valid identity and preserves unavailable selections", async () => {
    const store = useDockProviderShowcaseStore;
    const previous = store.getState();
    const options = store.persist.getOptions();
    using _restore = {
      [Symbol.dispose]: () => {
        store.persist.setOptions(options);
        store.setState(previous, true);
      },
    };
    const storage = createMemoryStorage();
    storage.setItem(
      DOCK_PROVIDER_SHOWCASE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          selectedKeys: [
            null,
            "codex:offline-account",
            "codex:offline-account",
            "claude:work",
            "third",
          ],
          setSelectedKeys: "untrusted action",
        },
      }),
    );
    store.persist.setOptions({ storage: createJSONStorage(() => storage) });
    await store.persist.rehydrate();
    expect(store.getState().selectedKeys).toEqual([
      "codex:offline-account",
      "claude:work",
      "third",
    ]);
    expect(typeof store.getState().setSelectedKeys).toBe("function");
  });
});
