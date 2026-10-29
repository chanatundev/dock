import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { confirmMock, readLocalApiMock } = vi.hoisted(() => {
  const confirmMock = vi.fn<(message: string, options?: unknown) => Promise<boolean>>();
  const readLocalApiMock = vi.fn<
    () =>
      | {
          dialogs: { confirm: (message: string, options?: unknown) => Promise<boolean> };
        }
      | undefined
  >();
  return { confirmMock, readLocalApiMock };
});

vi.mock("~/localApi", () => ({
  readLocalApi: () => readLocalApiMock(),
}));

import { confirmTerminalClose, isTerminalCloseConfirmPending } from "./terminalCloseConfirm";

describe("terminal close confirmation", () => {
  beforeEach(() => {
    confirmMock.mockReset();
    readLocalApiMock.mockReset();
    readLocalApiMock.mockReturnValue({ dialogs: { confirm: confirmMock } });
  });

  it("clears pending state and resolves false when the dialog rejects", async () => {
    let reject: (reason?: unknown) => void = () => undefined;
    confirmMock.mockImplementation(
      () =>
        new Promise<boolean>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );

    const confirmation = confirmTerminalClose(["Terminal 1"]);
    expect(isTerminalCloseConfirmPending()).toBe(true);

    reject(new Error("dialog failed"));
    await expect(confirmation).resolves.toBe(false);
    expect(isTerminalCloseConfirmPending()).toBe(false);
  });
});

it("uses the child terminal label when host and child terminal IDs collide", async () => {
  const { terminalCloseLabels } = await import("./terminalCloseConfirm");
  const owner = scopeThreadRef(EnvironmentId.make("shared-env"), ThreadId.make("owner-thread"));
  const target = scopeThreadRef(EnvironmentId.make("shared-env"), ThreadId.make("worker-thread"));
  expect(
    terminalCloseLabels({
      owner,
      target,
      activeTerminalId: "term-1",
      terminalIds: ["term-1"],
      ownerLabels: new Map([["term-1", "Host build"]]),
      metadata: {
        environmentId: target.environmentId,
        summaries: [
          { threadId: owner.threadId, terminalId: "term-1", label: "Other build" },
          { threadId: target.threadId, terminalId: "term-1", label: "Worker build" },
        ],
      },
    }),
  ).toEqual(["Worker build"]);
  expect(
    terminalCloseLabels({
      owner,
      target,
      activeTerminalId: "term-1",
      terminalIds: ["term-1"],
      ownerLabels: new Map([["term-1", "Host build"]]),
      metadata: null,
    }),
  ).toEqual(["Terminal 1"]);
});
