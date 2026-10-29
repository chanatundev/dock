import { expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import {
  isSidechatThread,
  isStandaloneSidechatThread,
  sidechatThreadMetadata,
} from "./sidechatThread.ts";

it("recognizes source and standalone side chats without classifying ordinary threads", () => {
  expect(isSidechatThread({})).toBe(false);
  expect(isSidechatThread({ sidechatSourceThreadId: null, sidechatContext: null })).toBe(false);
  expect(isSidechatThread({ sidechatSourceThreadId: "parent" })).toBe(true);
  expect(isStandaloneSidechatThread({ sidechatSourceThreadId: "parent" })).toBe(false);
  expect(isStandaloneSidechatThread({ sidechatContext: { kind: "github-issue" } })).toBe(true);
});
it("keeps legacy fields absent while preserving capture provenance and lifecycle instants", () => {
  expect(sidechatThreadMetadata({})).toEqual({});
  const metadata = {
    sidechatSourceThreadId: ThreadId.make("parent"),
    sidechatContext: null,
    sidechatCapturedAt: "2026-10-25T12:00:00.000Z",
    sidechatSnapshotSequence: 0,
    sidechatLastActivityAt: "2026-10-25T12:01:00.000Z",
    sidechatExpiredAt: null,
  };
  expect(sidechatThreadMetadata(metadata)).toEqual(metadata);
});
