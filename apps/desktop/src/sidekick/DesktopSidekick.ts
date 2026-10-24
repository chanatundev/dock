import {
  DESKTOP_SIDEKICK_ACTIVATE_MENU_ACTION,
  DESKTOP_SIDEKICK_SIZE_LABELS,
  DESKTOP_SIDEKICK_THREADS_LABELS,
  desktopSidekickOpenThreadMenuAction,
  type DesktopSidekickPreferences,
  type DesktopSidekickPreferencesPatch,
  type DesktopSidekickSize,
  type DesktopSidekickStatus,
  type DesktopSidekickThreads,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Electron from "electron";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import {
  SIDEKICK_PREFERENCES_CHANGED_CHANNEL,
  SIDEKICK_WINDOW_INPUT_CHANNEL,
  SIDEKICK_WINDOW_LAYOUT_CHANNEL,
  SIDEKICK_WINDOW_PINNED_CHANNEL,
  SIDEKICK_WINDOW_STATUS_CHANNEL,
} from "../ipc/channels.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import {
  expandSidekickBounds,
  resizeSidekickPosition,
  resolveSidekickPosition,
  SIDEKICK_PANEL_GAP_PX,
  SIDEKICK_SIZE_PX,
} from "./SidekickGeometry.ts";
import { SidekickWindowInput, type SidekickWindowLayout } from "./SidekickWindowInput.ts";

export const INITIAL_SIDEKICK_STATUS: DesktopSidekickStatus = {
  state: "waiting",
  badgeCount: 0,
  tooltip: "",
  sessions: [],
  moreCount: 0,
};

/** Shown once the renderer that publishes status is gone (e.g. the main window closed on macOS). */
export const UNOBSERVED_SIDEKICK_STATUS: DesktopSidekickStatus = {
  state: "offline",
  badgeCount: 0,
  tooltip: "Open dock to see what your agents are doing",
  sessions: [],
  moreCount: 0,
};

export const toSidekickPreferences = (
  settings: DesktopAppSettings.DesktopSettings,
): DesktopSidekickPreferences => ({
  enabled: settings.sidekickEnabled,
  size: settings.sidekickSize,
  threads: settings.sidekickThreads,
});

const { logWarning } = makeComponentLogger("desktop-sidekick");
const decodeWindowInput = Schema.decodeUnknownOption(SidekickWindowInput);

/**
 * Owns the floating sidekick window: its persisted preferences, the latest
 * status the main renderer rolled up, and the pointer input from the window
 * itself. Preference changes are broadcast so every entry point (settings,
 * slash command, menus) stays in sync.
 */
export class DesktopSidekick extends Context.Service<
  DesktopSidekick,
  {
    /** Shows the window if enabled and starts following display changes. Call once the app is ready. */
    readonly start: Effect.Effect<void, never, Scope.Scope>;
    /** `publisherId` is the sending webContents; its teardown resets the status. */
    readonly setStatus: (
      status: DesktopSidekickStatus,
      publisherId?: number,
    ) => Effect.Effect<void>;
    readonly preferences: Effect.Effect<DesktopSidekickPreferences>;
    readonly setPreferences: (
      patch: DesktopSidekickPreferencesPatch,
    ) => Effect.Effect<DesktopSidekickPreferences, DesktopAppSettings.DesktopSettingsWriteError>;
  }
>()("@t3tools/desktop/sidekick/DesktopSidekick") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const assets = yield* DesktopAssets.DesktopAssets;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronMenu = yield* ElectronMenu.ElectronMenu;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());

  const statusRef = yield* Ref.make(INITIAL_SIDEKICK_STATUS);
  const startedRef = yield* Ref.make(false);
  // Electron objects live on the main thread; plain mutable state is enough.
  let sidekickWindow: Electron.BrowserWindow | null = null;
  let windowSize = 0;
  let windowSizeVariant: DesktopSidekickSize = "medium";
  let dragOrigin: { readonly x: number; readonly y: number } | null = null;
  // Where the sprite sits inside the window while the hover list is open.
  // Null while collapsed, when the window is exactly the sprite.
  let spriteOffset: { readonly x: number; readonly y: number } | null = null;

  const liveWindow = () =>
    sidekickWindow !== null && !sidekickWindow.isDestroyed() ? sidekickWindow : null;

  const sendLayout = (window: Electron.BrowserWindow, layout: SidekickWindowLayout) =>
    window.webContents.send(SIDEKICK_WINDOW_LAYOUT_CHANNEL, layout);

  /** The sprite's top-left on screen, which is what gets persisted. */
  const spritePosition = (window: Electron.BrowserWindow) => {
    const [x, y] = window.getPosition();
    return { x: (x ?? 0) + (spriteOffset?.x ?? 0), y: (y ?? 0) + (spriteOffset?.y ?? 0) };
  };

  /** Shrinks back to just the sprite. Everything that moves or resizes the sprite collapses first. */
  const collapse = (window: Electron.BrowserWindow) => {
    if (spriteOffset === null) return;
    const sprite = spritePosition(window);
    spriteOffset = null;
    window.setBounds({ ...sprite, width: windowSize, height: windowSize });
    sendLayout(window, {
      expanded: false,
      size: windowSize,
      sizeVariant: windowSizeVariant,
    });
  };

  /** Grows the window around the sprite so the hover list fits, keeping the sprite still. */
  const expand = (
    window: Electron.BrowserWindow,
    panel: { readonly width: number; readonly height: number },
  ) => {
    const sprite = spritePosition(window);
    const { bounds, layout } = expandSidekickBounds({
      sprite,
      size: windowSize,
      panel,
      workArea: Electron.screen.getDisplayMatching({
        ...sprite,
        width: windowSize,
        height: windowSize,
      }).workArea,
    });
    // Anchor the sprite to the corner that stays put before the window grows,
    // so the sprite keeps its screen position through the resize.
    sendLayout(window, {
      expanded: true,
      size: windowSize,
      sizeVariant: windowSizeVariant,
      gap: SIDEKICK_PANEL_GAP_PX,
      ...layout,
    });
    spriteOffset = { x: sprite.x - bounds.x, y: sprite.y - bounds.y };
    const current = window.getBounds();
    if (
      current.x !== bounds.x ||
      current.y !== bounds.y ||
      current.width !== bounds.width ||
      current.height !== bounds.height
    ) {
      window.setBounds(bounds);
    }
  };

  const resolvePosition = (
    saved: DesktopAppSettings.DesktopSidekickPosition | null,
    size: number,
  ) =>
    resolveSidekickPosition({
      saved,
      size,
      workAreas: Electron.screen.getAllDisplays().map((display) => display.workArea),
      primaryWorkArea: Electron.screen.getPrimaryDisplay().workArea,
    });

  const persistPosition = (position: DesktopAppSettings.DesktopSidekickPosition | null) =>
    appSettings
      .setSidekickPosition(position)
      .pipe(
        Effect.catch((error) =>
          logWarning("could not persist sidekick position", { message: error.message }),
        ),
      );

  const sendStatus = Effect.gen(function* () {
    const window = liveWindow();
    if (window === null || window.webContents.isLoadingMainFrame()) return;
    window.webContents.send(SIDEKICK_WINDOW_STATUS_CHANNEL, yield* Ref.get(statusRef));
  });

  /** The page owns when the list opens; it only needs to know whether it stays open. */
  const sendThreadsMode = Effect.gen(function* () {
    const window = liveWindow();
    if (window === null || window.webContents.isLoadingMainFrame()) return;
    const { sidekickThreads } = yield* appSettings.get;
    window.webContents.send(SIDEKICK_WINDOW_PINNED_CHANNEL, sidekickThreads === "always");
  });

  /** Moves the window back inside a display, e.g. after a monitor is unplugged. */
  const reclamp = Effect.gen(function* () {
    const window = liveWindow();
    if (window === null) return;
    collapse(window);
    const [x, y] = window.getPosition();
    const next = resolvePosition({ x: x ?? 0, y: y ?? 0 }, windowSize);
    if (next.x !== x || next.y !== y) {
      window.setPosition(next.x, next.y);
      yield* persistPosition(next);
    }
  });

  const updateStatus = (status: DesktopSidekickStatus) =>
    Ref.getAndSet(statusRef, status).pipe(
      Effect.flatMap((previous) => {
        if (JSON.stringify(previous) === JSON.stringify(status)) return Effect.void;
        const window = liveWindow();
        if (window !== null && status.sessions.length === 0) collapse(window);
        return sendStatus;
      }),
    );

  // Only the main renderer rolls up status. When its page goes away nothing
  // would ever correct the last pose, so fall back to an honest "not watching".
  const watchedPublishers = new Set<number>();
  const watchPublisher = (publisherId: number) => {
    if (watchedPublishers.has(publisherId)) return;
    const publisher = Electron.webContents.fromId(publisherId);
    if (publisher === undefined || publisher.isDestroyed()) return;
    watchedPublishers.add(publisherId);
    publisher.once("destroyed", () => {
      watchedPublishers.delete(publisherId);
      runFork(updateStatus(UNOBSERVED_SIDEKICK_STATUS));
    });
  };

  const setPreferences = Effect.fn("desktop.sidekick.setPreferences")(function* (
    patch: DesktopSidekickPreferencesPatch,
  ) {
    const change = yield* appSettings.setSidekickPreferences(patch);
    const next = toSidekickPreferences(change.settings);
    if (change.changed) {
      yield* electronWindow.sendAll(SIDEKICK_PREFERENCES_CHANGED_CHANNEL, next);
      yield* sync;
    }
    return next;
  });

  const runSetPreferences = (patch: DesktopSidekickPreferencesPatch) =>
    runFork(
      setPreferences(patch).pipe(
        Effect.catch((error) =>
          logWarning("could not update sidekick preferences", { message: error.message }),
        ),
      ),
    );

  const showContextMenu = Effect.gen(function* () {
    const window = liveWindow();
    if (window === null) return;
    const { state } = yield* Ref.get(statusRef);
    const settings = yield* appSettings.get;
    const idle = state === "waiting" || state === "sleeping" || state === "offline";
    yield* electronMenu.popupTemplate({
      window,
      template: [
        {
          label: idle ? "Open dock" : "Open Thread",
          click: () => runFork(activate),
        },
        { type: "separator" },
        {
          label: "Size",
          submenu: (Object.keys(DESKTOP_SIDEKICK_SIZE_LABELS) as DesktopSidekickSize[]).map(
            (size) => ({
              label: DESKTOP_SIDEKICK_SIZE_LABELS[size],
              type: "radio" as const,
              checked: settings.sidekickSize === size,
              click: () => runSetPreferences({ size }),
            }),
          ),
        },
        {
          label: "Show Threads",
          submenu: (Object.keys(DESKTOP_SIDEKICK_THREADS_LABELS) as DesktopSidekickThreads[]).map(
            (threads) => ({
              label: DESKTOP_SIDEKICK_THREADS_LABELS[threads],
              type: "radio" as const,
              checked: settings.sidekickThreads === threads,
              click: () => runSetPreferences({ threads }),
            }),
          ),
        },
        {
          label: "Reset Position",
          click: () =>
            runFork(
              Effect.gen(function* () {
                const current = liveWindow();
                if (current === null) return;
                collapse(current);
                const next = resolvePosition(null, windowSize);
                current.setPosition(next.x, next.y);
                yield* persistPosition(null);
              }),
            ),
        },
        { type: "separator" },
        { label: "Hide Sidekick", click: () => runSetPreferences({ enabled: false }) },
      ],
    });
  });

  // The renderer picks which thread to open; the desktop only reveals it.
  const activate = desktopWindow
    .dispatchMenuAction(DESKTOP_SIDEKICK_ACTIVATE_MENU_ACTION, { reveal: true })
    .pipe(
      Effect.catch((error) =>
        logWarning("could not activate from sidekick", { message: error.message }),
      ),
    );

  // Only threads the page was actually shown can be opened from it.
  const openThread = (thread: ScopedThreadRef) =>
    Effect.gen(function* () {
      const { sessions } = yield* Ref.get(statusRef);
      const listed = sessions.some(
        (session) =>
          session.environmentId === thread.environmentId && session.threadId === thread.threadId,
      );
      if (!listed) return;
      yield* desktopWindow
        .dispatchMenuAction(desktopSidekickOpenThreadMenuAction(thread), { reveal: true })
        .pipe(
          Effect.catch((error) =>
            logWarning("could not open thread from sidekick", { message: error.message }),
          ),
        );
    });

  const handleInput = (event: Electron.IpcMainEvent, raw: unknown) => {
    const window = liveWindow();
    if (window === null || event.sender !== window.webContents) return;
    const decoded = decodeWindowInput(raw);
    if (Option.isNone(decoded)) return;
    const input = decoded.value;
    switch (input.type) {
      case "drag-start": {
        collapse(window);
        const [x, y] = window.getPosition();
        dragOrigin = { x: x ?? 0, y: y ?? 0 };
        return;
      }
      case "drag-move": {
        if (dragOrigin === null) return;
        window.setPosition(
          Math.round(dragOrigin.x + input.dx),
          Math.round(dragOrigin.y + input.dy),
        );
        return;
      }
      case "drag-end": {
        dragOrigin = null;
        runFork(reclamp.pipe(Effect.andThen(persistCurrentPosition)));
        return;
      }
      case "click":
        runFork(activate);
        return;
      case "context-menu":
        runFork(showContextMenu);
        return;
      case "expand": {
        if (dragOrigin !== null) return;
        runFork(
          Effect.gen(function* () {
            const { sessions } = yield* Ref.get(statusRef);
            if (window.isDestroyed()) return;
            if (sessions.length > 0 && input.height > 0) expand(window, input);
            else collapse(window);
          }),
        );
        return;
      }
      case "collapse":
        collapse(window);
        return;
      case "open-thread":
        runFork(openThread(input));
        return;
    }
  };

  const persistCurrentPosition = Effect.gen(function* () {
    const window = liveWindow();
    if (window === null) return;
    yield* persistPosition(spritePosition(window));
  });

  const createWindow = Effect.fn("desktop.sidekick.createWindow")(function* (
    settings: DesktopAppSettings.DesktopSettings,
  ) {
    const htmlPath = yield* assets
      .resolveResourcePath("sidekick/index.html")
      .pipe(
        Effect.catch((error) =>
          logWarning("could not probe sidekick page", { message: error.message }).pipe(
            Effect.as(Option.none<string>()),
          ),
        ),
      );
    if (Option.isNone(htmlPath)) {
      yield* logWarning("sidekick page is missing from the desktop resources");
      return;
    }
    const size = SIDEKICK_SIZE_PX[settings.sidekickSize];
    const position = resolvePosition(settings.sidekickPosition, size);
    const window = new Electron.BrowserWindow({
      ...position,
      width: size,
      height: size,
      title: "Sidekick",
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      backgroundColor: "#00000000",
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // Never steal focus from whatever the user is typing into.
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      ...(environment.platform === "darwin" ? { type: "panel" as const } : {}),
      webPreferences: {
        preload: environment.path.join(environment.dirname, "sidekick-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // Status level on macOS: tiling window managers with virtual workspaces
    // (e.g. OmniWM) adopt floating-level windows and park them off-screen on
    // every workspace switch, but leave status-level surfaces alone.
    window.setAlwaysOnTop(true, environment.platform === "darwin" ? "status" : "normal");
    if (environment.platform === "darwin") {
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        // Electron otherwise temporarily transforms the entire app into a
        // UIElement process, which removes the owning app from the Dock.
        skipTransformProcessType: true,
      });
    }
    window.once("ready-to-show", () => {
      if (!window.isDestroyed()) window.showInactive();
    });
    window.webContents.on("did-finish-load", () => {
      sendLayout(window, {
        expanded: false,
        size: windowSize,
        sizeVariant: windowSizeVariant,
      });
      runFork(sendStatus.pipe(Effect.andThen(sendThreadsMode)));
    });
    window.once("closed", () => {
      if (sidekickWindow === window) sidekickWindow = null;
    });
    yield* electronWindow.markAuxiliary(window);
    sidekickWindow = window;
    windowSize = size;
    windowSizeVariant = settings.sidekickSize;
    spriteOffset = null;
    void window.loadFile(htmlPath.value).catch(() => undefined);
  });

  /** Brings the window in line with the persisted preferences. */
  const sync: Effect.Effect<void> = Effect.gen(function* () {
    if (!(yield* Ref.get(startedRef))) return;
    const settings = yield* appSettings.get;
    const window = liveWindow();
    if (!settings.sidekickEnabled) {
      // Destroy synchronously: an async close() would still look live to a
      // re-enable that lands before "closed" fires.
      if (window !== null) {
        sidekickWindow = null;
        window.destroy();
      }
      return;
    }
    if (window === null) {
      yield* createWindow(settings);
      return;
    }
    yield* sendThreadsMode;
    const size = SIDEKICK_SIZE_PX[settings.sidekickSize];
    if (size === windowSize && settings.sidekickSize === windowSizeVariant) return;
    collapse(window);
    const [x, y] = window.getPosition();
    const next = resolvePosition(
      resizeSidekickPosition({ x: x ?? 0, y: y ?? 0 }, windowSize, size),
      size,
    );
    windowSize = size;
    windowSizeVariant = settings.sidekickSize;
    window.setBounds({ ...next, width: size, height: size });
    sendLayout(window, {
      expanded: false,
      size: windowSize,
      sizeVariant: windowSizeVariant,
    });
    yield* persistPosition(next);
  }).pipe(Effect.withSpan("desktop.sidekick.sync"));

  const start = Effect.gen(function* () {
    if (yield* Ref.getAndSet(startedRef, true)) return;
    const onDisplaysChanged = () => runFork(reclamp);
    Electron.ipcMain.on(SIDEKICK_WINDOW_INPUT_CHANNEL, handleInput);
    Electron.screen.on("display-removed", onDisplaysChanged);
    Electron.screen.on("display-metrics-changed", onDisplaysChanged);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        Electron.ipcMain.removeListener(SIDEKICK_WINDOW_INPUT_CHANNEL, handleInput);
        Electron.screen.removeListener("display-removed", onDisplaysChanged);
        Electron.screen.removeListener("display-metrics-changed", onDisplaysChanged);
        liveWindow()?.destroy();
      }),
    );
    // Outside macOS the app quits when its last window closes. The sidekick
    // must not keep it alive, so it leaves when it is the only window left.
    if (environment.platform !== "darwin") {
      yield* electronApp.on(
        "browser-window-created",
        (_event: Electron.Event, created: Electron.BrowserWindow) => {
          created.once("closed", () => {
            const window = liveWindow();
            if (window === null || window === created) return;
            const others = Electron.BrowserWindow.getAllWindows().filter(
              (candidate) => candidate !== window && !candidate.isDestroyed(),
            );
            if (others.length === 0) window.destroy();
          });
        },
      );
    }
    yield* sync;
  }).pipe(Effect.withSpan("desktop.sidekick.start"));

  return DesktopSidekick.of({
    start,
    setStatus: (status, publisherId) =>
      Effect.gen(function* () {
        if (publisherId !== undefined) watchPublisher(publisherId);
        yield* updateStatus(status);
      }),
    preferences: appSettings.get.pipe(Effect.map(toSidekickPreferences)),
    setPreferences,
  });
});

export const layer = Layer.effect(DesktopSidekick, make);
