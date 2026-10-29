import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  OrchestrationV2SidechatSnapshotJson,
  OrchestrationV2StoredEventJson,
} from "./orchestrationV2.ts";

const snapshot = {
  source: {
    kind: "thread",
    threadId: "parent",
    capturedAt: "2026-10-26T12:00:00.000Z",
    snapshotSequence: 42,
  },
  items: [],
  referenceText: "Frozen reference",
};

describe("immutable side-chat context", () => {
  it("round-trips a capture independently of the parent record", () => {
    const decode = Schema.decodeUnknownSync(OrchestrationV2SidechatSnapshotJson);
    const encode = Schema.encodeSync(OrchestrationV2SidechatSnapshotJson);
    expect(encode(decode(snapshot))).toEqual(snapshot);
  });

  it("replays the capture event and permits a compact wire notice", () => {
    const decode = Schema.decodeUnknownSync(OrchestrationV2StoredEventJson);
    const encode = Schema.encodeSync(OrchestrationV2StoredEventJson);
    const event = {
      id: "capture-event",
      threadId: "side",
      type: "sidechat.context-captured",
      occurredAt: "2026-10-26T12:00:00.000Z",
      payload: { source: snapshot.source, itemCount: 0, snapshot },
    };
    const stored = { sequence: 43, commandId: "capture-command", event };
    expect(encode(decode(stored))).toEqual(stored);
    const notice = {
      ...stored,
      event: { ...event, payload: { source: snapshot.source, itemCount: 0 } },
    };
    expect(encode(decode(notice))).toEqual(notice);
  });
});
