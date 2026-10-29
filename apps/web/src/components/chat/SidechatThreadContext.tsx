import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  CommandId,
  type OrchestrationV2ThreadShell,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { randomUUID } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { GitHubIssueContextChip } from "../GitHubIssueContextChip";
import { AttachmentFilePreview } from "../files/AttachmentFilePreview";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";

function OpeningContext({
  threadRef,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  onClose: () => void;
}) {
  const [assetOffset, setAssetOffset] = useState(0);
  const opening = useEnvironmentQuery(
    serverEnvironment.sidechatContext({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, limit: 2, assetLimit: 20 },
    }),
  );
  const page = useEnvironmentQuery(
    assetOffset === 0
      ? null
      : serverEnvironment.sidechatContext({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, offset: 2, limit: 2, assetOffset, assetLimit: 20 },
        }),
  );
  const data = assetOffset === 0 ? opening.data : page.data;
  const error = assetOffset === 0 ? opening.error : page.error;
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const asset = data?.assets?.find((item) => item.attachment?.id === selectedAsset)?.attachment;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Opening context</DialogTitle>
          <DialogDescription>
            This frozen reference stays unchanged when its source is edited or deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            {opening.data ? (
              <p className="text-sm text-muted-foreground">
                Captured {new Date(opening.data.source.capturedAt).toLocaleString()} ·{" "}
                {opening.data.totalItems} conversation items
              </p>
            ) : opening.error ? null : (
              <p role="status">Loading opening context…</p>
            )}
            {opening.data?.issueContext ? (
              <GitHubIssueContextChip record={opening.data.issueContext} />
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {(opening.data?.totalAssets ?? 0) > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Frozen files ({opening.data?.totalAssets})</h3>
                <ul className="space-y-1">
                  {data?.assets?.map((item) => (
                    <li
                      key={item.sourceAttachmentId}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {item.attachment?.name ?? item.name ?? item.sourceAttachmentId}
                      </span>
                      {item.attachment === null || item.path === null ? (
                        <span className="text-xs text-muted-foreground">Unavailable</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedAsset(item.attachment?.id ?? null)}
                        >
                          Open
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  {assetOffset > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedAsset(null);
                        setAssetOffset(Math.max(0, assetOffset - 20));
                      }}
                    >
                      Previous files
                    </Button>
                  ) : null}
                  {data?.nextAssetOffset != null ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedAsset(null);
                        setAssetOffset(data.nextAssetOffset!);
                      }}
                    >
                      Next files
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {asset ? (
              <div className="h-80 min-w-0 overflow-hidden rounded-lg border border-border">
                <AttachmentFilePreview
                  name={asset.name}
                  mimeType={asset.mimeType}
                  sizeBytes={asset.sizeBytes}
                  asset={{ environmentId: threadRef.environmentId, attachmentId: asset.id }}
                  threadRef={threadRef}
                />
              </div>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ReturnToParent({
  threadRef,
  initialText,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  initialText: string;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<ScopedThreadRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ text: string; commandId: CommandId } | null>(null);
  const lock = useRef(false);
  const send = useAtomCommand(serverEnvironment.sendSidechatToParent, { reportFailure: false });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Queue reviewed text in parent</DialogTitle>
          <DialogDescription>
            Review this message before it joins the parent's queue. Current work keeps running.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Textarea
            aria-label="Reviewed text for parent"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={busy || sent !== null}
            rows={8}
          />
          {error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {sent ? (
            <p role="status" className="mt-2 text-sm">
              Queued.{" "}
              <Link className="underline" to="/$environmentId/$threadId" params={sent}>
                Open parent
              </Link>
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {sent ? "Close" : "Cancel"}
          </Button>
          {!sent ? (
            <Button
              disabled={busy || !text.trim()}
              onClick={async () => {
                if (lock.current || !text.trim()) return;
                lock.current = true;
                setBusy(true);
                setError(null);
                if (request.current?.text !== text)
                  request.current = { text, commandId: CommandId.make(randomUUID()) };
                try {
                  const result = await send({
                    environmentId: threadRef.environmentId,
                    input: {
                      commandId: request.current.commandId,
                      sidechatThreadId: threadRef.threadId,
                      text,
                    },
                  });
                  if (result._tag === "Success")
                    setSent(scopeThreadRef(threadRef.environmentId, result.value.threadId));
                  else
                    setError(
                      "Could not confirm that the message was queued. Retry to reconcile this request.",
                    );
                } finally {
                  lock.current = false;
                  setBusy(false);
                }
              }}
            >
              {busy ? "Queuing…" : "Queue in parent"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function SidechatThreadContext({
  threadRef,
  thread,
}: {
  threadRef: ScopedThreadRef;
  thread: Pick<
    OrchestrationV2ThreadShell,
    "sidechatContext" | "sidechatSourceThreadId" | "sidechatExpiredAt"
  >;
}) {
  const [opening, setOpening] = useState(false);
  const [returnText, setReturnText] = useState<string | null>(null);
  const canReturn = useAtomValue(
    serverEnvironment.sendSidechatToParent.permissionAtom(threadRef.environmentId),
  );
  const source = thread.sidechatContext;
  const expired = thread.sidechatExpiredAt != null;
  return (
    <aside
      aria-label="Side-chat context"
      className="shrink-0 space-y-2 border-b border-border px-4 py-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Side chat{expired ? " · Expired" : ""}</span>
        {thread.sidechatSourceThreadId ? (
          <Link
            className="underline"
            to="/$environmentId/$threadId"
            params={{
              environmentId: threadRef.environmentId,
              threadId: thread.sidechatSourceThreadId,
            }}
          >
            Parent conversation
          </Link>
        ) : null}
        {source ? (
          <span className="min-w-0 truncate">
            {source.repository}#{source.number}
          </span>
        ) : null}
        <Button variant="ghost" size="xs" onClick={() => setOpening(true)}>
          Opening context
        </Button>
        {thread.sidechatSourceThreadId ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={!canReturn}
            onClick={() => setReturnText(window.getSelection()?.toString() ?? "")}
          >
            Return reviewed text
          </Button>
        ) : null}
      </div>
      {opening ? <OpeningContext threadRef={threadRef} onClose={() => setOpening(false)} /> : null}
      {returnText !== null ? (
        <ReturnToParent
          threadRef={threadRef}
          initialText={returnText}
          onClose={() => setReturnText(null)}
        />
      ) : null}
    </aside>
  );
}
