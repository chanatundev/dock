import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  focused: true,
  appState: "active",
  supported: true,
  mountRequests: [] as Array<unknown>,
  releases: [] as Array<unknown>,
  appStateListener: null as ((state: string) => void) | null,
  removedListeners: 0,
}));

vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return mocks.appState;
    },
    addEventListener: (_event: "change", listener: (state: string) => void) => {
      mocks.appStateListener = listener;
      return {
        remove: () => {
          if (mocks.appStateListener === listener) mocks.appStateListener = null;
          mocks.removedListeners += 1;
        },
      };
    },
  },
}));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () =>
    mocks.supported ? { environment: { capabilities: { dockSidechatViews: true } } } : null,
}));
vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: {
    mount: (request: unknown) => {
      mocks.mountRequests.push(request);
      return () => mocks.releases.push(request);
    },
  },
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    configValueAtom: (environmentId: string) => ({ kind: "config", environmentId }),
    sidechatView: (input: {
      readonly environmentId: string;
      readonly input: { readonly threadId: string };
    }) => ({
      kind: "sidechat-view",
      ...input,
    }),
  },
}));

import { useSidechatViewLease } from "./useSidechatViewLease";

const environmentId = "environment-1" as EnvironmentId;
const threadId = "thread-1" as ThreadId;

function Probe(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly enabled: boolean;
}) {
  useSidechatViewLease(props.environmentId, props.threadId, props.enabled);
  return null;
}

let root: Root | null = null;

function render(
  props: {
    readonly environmentId?: EnvironmentId;
    readonly threadId?: ThreadId;
    readonly enabled?: boolean;
  } = {},
) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root ??= createRoot(document.createElement("div"));
  act(() =>
    root!.render(
      <StrictMode>
        <Probe
          environmentId={props.environmentId ?? environmentId}
          threadId={props.threadId ?? threadId}
          enabled={props.enabled ?? true}
        />
      </StrictMode>,
    ),
  );
}

function unmount() {
  act(() => root?.unmount());
  root = null;
}

beforeEach(() => {
  mocks.focused = true;
  mocks.appState = "active";
  mocks.supported = true;
  mocks.mountRequests = [];
  mocks.releases = [];
  mocks.appStateListener = null;
  mocks.removedListeners = 0;
});

afterEach(unmount);

describe("useSidechatViewLease", () => {
  it("reacquires after StrictMode effect replay and releases on unmount", () => {
    render();

    expect(mocks.mountRequests).toHaveLength(2);
    expect(mocks.releases).toHaveLength(1);

    unmount();
    expect(mocks.releases).toHaveLength(2);
  });

  it("tracks focus, foreground, capability, and thread identity", () => {
    render();
    expect(mocks.mountRequests).toHaveLength(2);

    mocks.focused = false;
    render();
    expect(mocks.releases).toHaveLength(2);

    mocks.focused = true;
    render();
    expect(mocks.mountRequests).toHaveLength(3);

    act(() => mocks.appStateListener?.("background"));
    expect(mocks.releases).toHaveLength(3);

    act(() => mocks.appStateListener?.("active"));
    expect(mocks.mountRequests).toHaveLength(4);

    mocks.supported = false;
    render();
    expect(mocks.releases).toHaveLength(4);

    mocks.supported = true;
    render({ threadId: "thread-2" as ThreadId });
    expect(mocks.mountRequests).toHaveLength(5);
    expect(mocks.releases).toHaveLength(4);
    expect(mocks.mountRequests[4]).toEqual({
      kind: "sidechat-view",
      environmentId,
      input: { threadId: "thread-2" },
    });

    const nextEnvironmentId = "environment-2" as EnvironmentId;
    render({ environmentId: nextEnvironmentId, threadId: "thread-2" as ThreadId, enabled: false });
    expect(mocks.releases).toHaveLength(5);
    expect(mocks.mountRequests).toHaveLength(5);

    render({ environmentId: nextEnvironmentId, threadId: "thread-2" as ThreadId });
    expect(mocks.mountRequests).toHaveLength(6);
    expect(mocks.mountRequests[5]).toEqual({
      kind: "sidechat-view",
      environmentId: nextEnvironmentId,
      input: { threadId: "thread-2" },
    });

    unmount();
    expect(mocks.releases).toHaveLength(6);
  });
});
