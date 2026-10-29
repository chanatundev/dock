// Adapted from Synara revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import { describe, expect, it, vi } from "vite-plus/test";

import {
  SIDECHAT_INACTIVITY_EXPIRY_MS,
  createSidechatExpiryTimer,
  sidechatExpiryMs,
} from "./sidechatExpiry.ts";

function makeClock(startAtMs = 0) {
  let nowMs = startAtMs;
  let nextTimerId = 1;
  const timers = new Map<number, { readonly callback: () => void; readonly dueAtMs: number }>();

  const advanceTo = (targetMs: number) => {
    nowMs = targetMs;
    while (true) {
      const dueTimer = [...timers.entries()]
        .filter(([, timer]) => timer.dueAtMs <= nowMs)
        .toSorted((left, right) => left[1].dueAtMs - right[1].dueAtMs)[0];
      if (!dueTimer) return;
      timers.delete(dueTimer[0]);
      dueTimer[1].callback();
    }
  };

  return {
    now: () => nowMs,
    schedule: (callback: () => void, delayMs: number) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, { callback, dueAtMs: nowMs + delayMs });
      return timerId;
    },
    cancel: (timerId: number) => {
      timers.delete(timerId);
    },
    advanceTo,
    activeTimerCount: () => timers.size,
  };
}

describe("sidechat expiry timer", () => {
  it("expires an idle sidechat after one hour", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });

    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: false,
      expired: false,
    });
    clock.advanceTo(1_000 + SIDECHAT_INACTIVITY_EXPIRY_MS - 1);
    expect(onExpire).not.toHaveBeenCalled();

    clock.advanceTo(1_000 + SIDECHAT_INACTIVITY_EXPIRY_MS);
    expect(onExpire).toHaveBeenCalledWith("sidechat-1", 1_000);
  });

  it("re-times idle sidechats when the configured window changes", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, expiryMs: null, onExpire });
    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: false,
      expired: false,
    });

    clock.advanceTo(1_000 + 30 * SIDECHAT_INACTIVITY_EXPIRY_MS);
    expect(onExpire).not.toHaveBeenCalled();

    timer.setExpiryMs(sidechatExpiryMs("24h"));
    clock.advanceTo(clock.now());
    expect(onExpire).toHaveBeenCalledWith("sidechat-1", 1_000);
  });

  it("re-arms a fired expiry when the window changes before its command completes", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });
    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: false,
      expired: false,
    });
    clock.advanceTo(1_000 + SIDECHAT_INACTIVITY_EXPIRY_MS);
    expect(onExpire).toHaveBeenCalledTimes(1);

    timer.setExpiryMs(sidechatExpiryMs("never"));
    timer.setExpiryMs(sidechatExpiryMs("24h"));
    clock.advanceTo(1_000 + 24 * SIDECHAT_INACTIVITY_EXPIRY_MS - 1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    clock.advanceTo(1_000 + 24 * SIDECHAT_INACTIVITY_EXPIRY_MS);
    expect(onExpire).toHaveBeenCalledTimes(2);
  });

  it("updates policy window using setPolicy", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });
    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: false,
      expired: false,
    });

    timer.setPolicy("never");
    clock.advanceTo(1_000 + 50 * SIDECHAT_INACTIVITY_EXPIRY_MS);
    expect(onExpire).not.toHaveBeenCalled();

    timer.setPolicy("1h");
    clock.advanceTo(clock.now());
    expect(onExpire).toHaveBeenCalledWith("sidechat-1", 1_000);
  });

  it("does not expire while viewed and restarts from the close time", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });
    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: false,
      expired: false,
    });

    clock.advanceTo(2_000);
    expect(timer.beginView("sidechat-1")).toBe(true);
    clock.advanceTo(2_000 + SIDECHAT_INACTIVITY_EXPIRY_MS);
    expect(onExpire).not.toHaveBeenCalled();

    timer.endView("sidechat-1");
    clock.advanceTo(2_000 + SIDECHAT_INACTIVITY_EXPIRY_MS * 2 - 1);
    expect(onExpire).not.toHaveBeenCalled();
    clock.advanceTo(2_000 + SIDECHAT_INACTIVITY_EXPIRY_MS * 2);
    expect(onExpire).toHaveBeenCalledWith("sidechat-1", 2_000 + SIDECHAT_INACTIVITY_EXPIRY_MS);
  });

  it("tracks viewer refcounts with multiple concurrent views", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });
    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: false,
      expired: false,
    });

    timer.beginView("sidechat-1", 2_000);
    timer.beginView("sidechat-1", 2_500);
    expect(timer.getViewedThreadIds()).toEqual(["sidechat-1"]);

    clock.advanceTo(2_500 + SIDECHAT_INACTIVITY_EXPIRY_MS);
    expect(onExpire).not.toHaveBeenCalled();

    // Closing one view leaves viewerCount at 1
    timer.endView("sidechat-1", 3_000);
    expect(timer.getViewedThreadIds()).toEqual(["sidechat-1"]);
    clock.advanceTo(3_000 + SIDECHAT_INACTIVITY_EXPIRY_MS);
    expect(onExpire).not.toHaveBeenCalled();

    // Closing the second view leaves viewerCount at 0
    timer.endView("sidechat-1", 4_000);
    expect(timer.getViewedThreadIds()).toEqual([]);

    clock.advanceTo(4_000 + SIDECHAT_INACTIVITY_EXPIRY_MS - 1);
    expect(onExpire).not.toHaveBeenCalled();
    clock.advanceTo(4_000 + SIDECHAT_INACTIVITY_EXPIRY_MS);
    expect(onExpire).toHaveBeenCalledWith("sidechat-1", 4_000);
  });

  it("clamps viewer count decrement at zero", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });
    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: false,
      expired: false,
    });

    // Extra endView calls do not drop viewerCount below 0
    timer.endView("sidechat-1", 1_500);
    timer.endView("sidechat-1", 1_600);
    expect(timer.getViewedThreadIds()).toEqual([]);

    // Single beginView should increment to 1
    timer.beginView("sidechat-1", 2_000);
    expect(timer.getViewedThreadIds()).toEqual(["sidechat-1"]);

    timer.endView("sidechat-1", 2_500);
    expect(timer.getViewedThreadIds()).toEqual([]);
  });

  it("defers expiry until a running turn settles", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });
    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: true,
      expired: false,
    });

    clock.advanceTo(1_000 + SIDECHAT_INACTIVITY_EXPIRY_MS * 2);
    expect(onExpire).not.toHaveBeenCalled();

    timer.setRunning("sidechat-1", false);
    clock.advanceTo(1_000 + SIDECHAT_INACTIVITY_EXPIRY_MS * 3 - 1);
    expect(onExpire).not.toHaveBeenCalled();
    clock.advanceTo(1_000 + SIDECHAT_INACTIVITY_EXPIRY_MS * 3);
    expect(onExpire).toHaveBeenCalledWith("sidechat-1", 1_000 + SIDECHAT_INACTIVITY_EXPIRY_MS * 2);
  });

  it("expires immediately when restored past its durable deadline", () => {
    const clock = makeClock(SIDECHAT_INACTIVITY_EXPIRY_MS + 1);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });

    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 0,
      running: false,
      expired: false,
    });
    clock.advanceTo(clock.now());

    expect(onExpire).toHaveBeenCalledWith("sidechat-1", 0);
  });

  it("preserves an already-acquired view when a committed create event is replayed", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });
    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: false,
      expired: false,
    });
    timer.beginView("sidechat-1");

    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: false,
      expired: false,
    });
    clock.advanceTo(1_000 + SIDECHAT_INACTIVITY_EXPIRY_MS);

    expect(onExpire).not.toHaveBeenCalled();
  });

  it("does not register or keep timers for already-expired sidechats on restore", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });

    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: false,
      expired: true,
    });
    clock.advanceTo(1_000 + SIDECHAT_INACTIVITY_EXPIRY_MS * 2);

    expect(onExpire).not.toHaveBeenCalled();
    expect(clock.activeTimerCount()).toBe(0);
  });

  it("backs off a rejected expiry instead of spinning at an elapsed deadline", () => {
    const now = SIDECHAT_INACTIVITY_EXPIRY_MS + 1;
    const clock = makeClock(now);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });
    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 0,
      running: false,
      expired: false,
    });
    clock.advanceTo(now);
    expect(onExpire).toHaveBeenCalledTimes(1);

    timer.retryExpiry("sidechat-1", 5_000);
    clock.advanceTo(now + 4_999);
    expect(onExpire).toHaveBeenCalledTimes(1);
    clock.advanceTo(now + 5_000);
    expect(onExpire).toHaveBeenCalledTimes(2);
  });

  it("retries immediately when retryExpiry is called with 0 delay", () => {
    const now = SIDECHAT_INACTIVITY_EXPIRY_MS + 1;
    const clock = makeClock(now);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });
    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 0,
      running: false,
      expired: false,
    });
    clock.advanceTo(now);
    expect(onExpire).toHaveBeenCalledTimes(1);

    timer.retryExpiry("sidechat-1", 0);
    clock.advanceTo(now);
    expect(onExpire).toHaveBeenCalledTimes(2);
  });

  it("cancels timers and clears state on dispose", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });
    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: false,
      expired: false,
    });
    expect(clock.activeTimerCount()).toBe(1);

    timer.dispose();
    expect(clock.activeTimerCount()).toBe(0);

    clock.advanceTo(1_000 + SIDECHAT_INACTIVITY_EXPIRY_MS * 2);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("removes thread on remove and markExpired", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });
    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: false,
      expired: false,
    });
    timer.restore({
      threadId: "sidechat-2",
      lastActivityAtMs: 1_000,
      running: false,
      expired: false,
    });

    timer.remove("sidechat-1");
    timer.markExpired("sidechat-2");
    expect(clock.activeTimerCount()).toBe(0);

    clock.advanceTo(1_000 + SIDECHAT_INACTIVITY_EXPIRY_MS * 2);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("ignores operations on unknown threads", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });

    expect(timer.beginView("unknown")).toBe(false);
    expect(timer.endView("unknown")).toBe(false);
    expect(timer.recordActivity("unknown")).toBe(false);
    expect(timer.setRunning("unknown", true)).toBe(false);
    timer.retryExpiry("unknown", 100);
    timer.remove("unknown");
    timer.markExpired("unknown");
    expect(clock.activeTimerCount()).toBe(0);
  });

  it("extends expiry when recordActivity is called", () => {
    const clock = makeClock(1_000);
    const onExpire = vi.fn();
    const timer = createSidechatExpiryTimer({ ...clock, onExpire });
    timer.restore({
      threadId: "sidechat-1",
      lastActivityAtMs: 1_000,
      running: false,
      expired: false,
    });

    clock.advanceTo(2_000);
    expect(timer.recordActivity("sidechat-1", 2_000)).toBe(true);

    clock.advanceTo(1_000 + SIDECHAT_INACTIVITY_EXPIRY_MS);
    expect(onExpire).not.toHaveBeenCalled();

    clock.advanceTo(2_000 + SIDECHAT_INACTIVITY_EXPIRY_MS);
    expect(onExpire).toHaveBeenCalledWith("sidechat-1", 2_000);
  });
});
