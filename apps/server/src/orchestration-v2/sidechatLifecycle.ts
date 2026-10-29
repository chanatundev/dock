// Adapted from Synara revision 29b11e105200c7bc6e2c71a06a375513d4c8a72d.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import * as DateTime from "effect/DateTime";

export const SIDECHAT_EXPIRED_EXECUTION_MESSAGE =
  "This side chat expired after a period of inactivity. Start a new side chat.";

export const SIDECHAT_BOUNDARY_INSTRUCTION =
  "You are in a sidechat. Treat all prior conversation as reference-only context. Do not continue any prior task automatically. Do not mutate files, git, or the workspace and do not run workspace-changing commands unless the latest user message explicitly asks you to do so after this boundary. Use this sidechat for focused explanation, safety checks, summaries, and alternatives.";

export interface SidechatExpiryState {
  readonly sidechatExpiredAt?: string | null | undefined;
  readonly expiredAt?: string | null | undefined;
}

export function isExpiredSidechat(thread: SidechatExpiryState | null | undefined): boolean {
  if (thread == null) return false;
  return thread.sidechatExpiredAt != null || thread.expiredAt != null;
}

function parseTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatIso(timestampMs: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(timestampMs));
}

export function latestSidechatActivityAt(
  current: string | null | undefined,
  candidate: string,
): string {
  const currentTimestamp = current == null ? null : parseTimestamp(current);
  const candidateTimestamp = parseTimestamp(candidate);
  if (candidateTimestamp === null) return current ?? candidate;
  if (currentTimestamp === null) return formatIso(candidateTimestamp);
  return formatIso(Math.max(currentTimestamp, candidateTimestamp));
}

export function sidechatActivityInstantsEqual(left: string, right: string): boolean {
  const leftTimestamp = parseTimestamp(left);
  const rightTimestamp = parseTimestamp(right);
  if (leftTimestamp === null || rightTimestamp === null) return left === right;
  return leftTimestamp === rightTimestamp;
}
