// Calendar cases adapted from Synara revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import { previousDayCutoffMs, resolveInboxDay } from "./inboxDay.ts";

const instant = (iso: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(iso));
const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
const newYork = "America/New_York";

describe("Inbox working day", () => {
  it("uses the preceding working day before 04:00 in the viewing timezone", () => {
    const day = resolveInboxDay(instant("2026-10-24T07:59:59.999Z"), newYork);
    expect(iso(day.fromMs)).toBe("2026-10-23T08:00:00.000Z");
    expect(iso(day.toMs)).toBe("2026-10-24T08:00:00.000Z");
    expect(day.currentSlotId).toBe("evening");
    expect(day.hours).toHaveLength(24);
  });
  it("changes slots at 04:00, 12:00 and 18:00 without shifting calendar days", () => {
    for (const [time, slot] of [
      ["08:00:00", "morning"],
      ["15:59:59", "morning"],
      ["16:00:00", "afternoon"],
      ["21:59:59", "afternoon"],
      ["22:00:00", "evening"],
    ] as const) {
      const day = resolveInboxDay(instant(`2026-10-24T${time}Z`), newYork);
      expect(day.currentSlotId).toBe(slot);
      expect(iso(day.fromMs)).toBe("2026-10-24T08:00:00.000Z");
      expect(day.previousDay.toMs).toBe(day.fromMs);
    }
  });
  it("keeps UTC clients on their own local day for the same instant", () => {
    const now = instant("2026-10-24T05:00:00Z");
    expect(iso(resolveInboxDay(now, "UTC").fromMs)).toBe("2026-10-24T04:00:00.000Z");
    expect(iso(resolveInboxDay(now, newYork).fromMs)).toBe("2026-10-23T08:00:00.000Z");
  });
  it("includes 23 actual hours across spring daylight saving", () => {
    const day = resolveInboxDay(instant("2026-03-08T07:30:00Z"), newYork);
    expect(iso(day.fromMs)).toBe("2026-03-07T09:00:00.000Z");
    expect(iso(day.toMs)).toBe("2026-03-08T08:00:00.000Z");
    expect(day.hours).toHaveLength(23);
    expect(day.slots.map((slot) => (slot.toMs - slot.fromMs) / 3_600_000)).toEqual([8, 6, 9]);
    expect(day.hours.at(-1)?.toMs).toBe(day.toMs);
  });
  it("includes both repeated autumn hours and contiguous slot boundaries", () => {
    const first = resolveInboxDay(instant("2026-11-01T05:30:00Z"), newYork);
    const second = resolveInboxDay(instant("2026-11-01T06:30:00Z"), newYork);
    expect(first).toEqual(second);
    expect(iso(first.fromMs)).toBe("2026-10-31T08:00:00.000Z");
    expect(iso(first.toMs)).toBe("2026-11-01T09:00:00.000Z");
    expect(first.hours).toHaveLength(25);
    expect(first.slots.map((slot) => (slot.toMs - slot.fromMs) / 3_600_000)).toEqual([8, 6, 11]);
    expect(first.hours.some((hour) => iso(hour.fromMs) === "2026-11-01T05:00:00.000Z")).toBe(true);
    expect(first.hours.some((hour) => iso(hour.fromMs) === "2026-11-01T06:00:00.000Z")).toBe(true);
    expect(first.slots[0]?.toMs).toBe(first.slots[1]?.fromMs);
    expect(first.slots[1]?.toMs).toBe(first.slots[2]?.fromMs);
  });
  it("compares the previous local clock time across daylight-saving changes", () => {
    expect(iso(previousDayCutoffMs(instant("2026-03-08T18:30:00Z"), newYork))).toBe(
      "2026-03-07T19:30:00.000Z",
    );
    expect(iso(previousDayCutoffMs(instant("2026-11-01T19:30:00Z"), newYork))).toBe(
      "2026-10-31T18:30:00.000Z",
    );
  });
});
