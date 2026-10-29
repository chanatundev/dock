// Side-chat identity adapted from Synara revision 3f55b77ef186764050ecf4edd6ae0879eec948a8.
// Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro. MIT; see third-party-notices/synara/LICENSE.
import type { OrchestrationV2AppThread } from "@t3tools/contracts";

interface SidechatIdentityFields {
  readonly sidechatSourceThreadId?: string | null | undefined;
  readonly sidechatContext?: unknown;
}
export function isSidechatThread(thread: SidechatIdentityFields): boolean {
  return Boolean(thread.sidechatSourceThreadId) || thread.sidechatContext != null;
}
export function isStandaloneSidechatThread(thread: SidechatIdentityFields): boolean {
  return !thread.sidechatSourceThreadId && thread.sidechatContext != null;
}

export type ThreadSidechatMetadata = Pick<
  OrchestrationV2AppThread,
  | "sidechatSourceThreadId"
  | "sidechatContext"
  | "sidechatCapturedAt"
  | "sidechatSnapshotSequence"
  | "sidechatLastActivityAt"
  | "sidechatExpiredAt"
>;
export function sidechatThreadMetadata(thread: ThreadSidechatMetadata) {
  // Absent optional keys must remain absent for legacy records and JSON codecs.
  return {
    ...(thread.sidechatSourceThreadId === undefined
      ? {}
      : { sidechatSourceThreadId: thread.sidechatSourceThreadId }),
    ...(thread.sidechatContext === undefined ? {} : { sidechatContext: thread.sidechatContext }),
    ...(thread.sidechatCapturedAt === undefined
      ? {}
      : { sidechatCapturedAt: thread.sidechatCapturedAt }),
    ...(thread.sidechatSnapshotSequence === undefined
      ? {}
      : { sidechatSnapshotSequence: thread.sidechatSnapshotSequence }),
    ...(thread.sidechatLastActivityAt === undefined
      ? {}
      : { sidechatLastActivityAt: thread.sidechatLastActivityAt }),
    ...(thread.sidechatExpiredAt === undefined
      ? {}
      : { sidechatExpiredAt: thread.sidechatExpiredAt }),
  };
}
