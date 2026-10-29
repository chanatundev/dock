// Working-day and slot behavior adapted from Synara's components/inbox/inbox.logic.ts,
// revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import * as DateTime from "effect/DateTime";

export type InboxSlotId = "morning" | "afternoon" | "evening";
export interface InboxTimeRange {
  readonly fromMs: number;
  readonly toMs: number;
}
export interface InboxSlot extends InboxTimeRange {
  readonly id: InboxSlotId;
  readonly label: string;
}
export interface InboxDayRange extends InboxTimeRange {
  readonly slots: readonly InboxSlot[];
  readonly hours: readonly InboxTimeRange[];
}
export interface InboxDay extends InboxDayRange {
  readonly currentSlotId: InboxSlotId;
  readonly previousDay: InboxDayRange;
}

const SLOT_STARTS = [
  { id: "morning", label: "Morning", hour: 4 },
  { id: "afternoon", label: "Afternoon", hour: 12 },
  { id: "evening", label: "Evening", hour: 18 },
] as const;
const HOUR_MS = 3_600_000;

function dayRange(start: DateTime.Zoned): InboxDayRange {
  const fromMs = DateTime.toEpochMillis(start);
  const toMs = DateTime.toEpochMillis(DateTime.add(start, { days: 1 }));
  const slots = SLOT_STARTS.map((slot, index) => {
    const next = SLOT_STARTS[index + 1];
    return {
      id: slot.id,
      label: slot.label,
      fromMs: DateTime.toEpochMillis(DateTime.setParts(start, { hour: slot.hour })),
      toMs:
        next === undefined
          ? toMs
          : DateTime.toEpochMillis(DateTime.setParts(start, { hour: next.hour })),
    };
  });
  // Buckets follow elapsed hours: the repeated autumn hour is distinct, and a spring gap has no bucket.
  const hours: InboxTimeRange[] = [];
  for (let hour = fromMs; hour < toMs; hour += HOUR_MS) {
    hours.push({ fromMs: hour, toMs: Math.min(hour + HOUR_MS, toMs) });
  }
  return { fromMs, toMs, slots, hours };
}

export function resolveInboxDay(nowMs: number, timeZone: string): InboxDay {
  const now = DateTime.makeZonedUnsafe(nowMs, { timeZone });
  const date = DateTime.toParts(now).hour < 4 ? DateTime.subtract(now, { days: 1 }) : now;
  const start = DateTime.setParts(date, { hour: 4, minute: 0, second: 0, millisecond: 0 });
  const today = dayRange(start);
  const currentSlot = today.slots.find((slot) => nowMs >= slot.fromMs && nowMs < slot.toMs);
  return {
    ...today,
    currentSlotId: currentSlot?.id ?? "evening",
    previousDay: dayRange(DateTime.subtract(start, { days: 1 })),
  };
}

export function previousDayCutoffMs(asOfMs: number, timeZone: string): number {
  return DateTime.toEpochMillis(
    DateTime.subtract(DateTime.makeZonedUnsafe(asOfMs, { timeZone }), { days: 1 }),
  );
}
