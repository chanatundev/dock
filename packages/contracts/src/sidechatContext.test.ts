import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";
import {
  SidechatContextError,
  SidechatReadContextInput,
  SidechatReadContextResult,
} from "./sidechatContext.ts";

const decodeInput = Schema.decodeUnknownSync(SidechatReadContextInput);
const decodeResult = Schema.decodeUnknownSync(SidechatReadContextResult);

describe("Sidechat read context contracts", () => {
  it("bounds the optional UTF-16 offset and page limit", () => {
    expect(decodeInput({ threadId: "side-thread" })).toEqual({ threadId: "side-thread" });
    expect(decodeInput({ threadId: "side-thread", offset: 12, limit: 2 })).toEqual({
      threadId: "side-thread",
      offset: 12,
      limit: 2,
    });
    expect(decodeInput({ threadId: "side-thread", limit: 16_000 }).limit).toBe(16_000);
    expect(() => decodeInput({ threadId: "side-thread", offset: -1 })).toThrow();
    expect(() => decodeInput({ threadId: "side-thread", offset: 1.5 })).toThrow();
    expect(() => decodeInput({ threadId: "side-thread", limit: 1 })).toThrow();
    expect(() => decodeInput({ threadId: "side-thread", limit: 16_001 })).toThrow();
  });

  it("accepts nullable final cursors and validates result counters", () => {
    expect(
      decodeResult({
        source: {
          kind: "thread",
          threadId: "parent-thread",
          snapshotSequence: 7,
          capturedAt: "2026-10-26T12:00:00.000Z",
        },
        totalItems: 1,
        totalChars: 10,
        offset: 8,
        text: "{}",
        nextOffset: null,
      }),
    ).toMatchObject({ totalItems: 1, totalChars: 10, offset: 8, text: "{}", nextOffset: null });
    expect(() => decodeResult({ totalItems: -1 })).toThrow();
  });

  it("provides a useful tagged error message", () => {
    const error = new SidechatContextError({
      threadId: ThreadId.make("side-thread"),
      reason: "not-found",
    });

    expect(error._tag).toBe("SidechatContextError");
    expect(error.message).toContain("side-thread");
    expect(error.message).toContain("frozen side-chat context");
  });
});
