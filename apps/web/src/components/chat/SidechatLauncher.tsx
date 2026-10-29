import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CommandId, type ModelSelection, type ScopedThreadRef } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useRightPanelStore } from "../../rightPanelStore";
import { useQuietThreadShell, useQuietThreadShells } from "../../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
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
import { ProviderModelPicker } from "./ProviderModelPicker";

export function SidechatLauncher({
  threadRef,
  hostRef,
  defaultModel,
  initialPrompt = "",
  onCreated,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  hostRef: ScopedThreadRef;
  defaultModel: ModelSelection;
  initialPrompt?: string;
  onCreated?: () => void;
  onClose: () => void;
}) {
  const open = useAtomCommand(serverEnvironment.openSidechat, { reportFailure: false });
  const allowed = useAtomValue(
    serverEnvironment.openSidechat.permissionAtom(threadRef.environmentId),
  );
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const supported = config?.environment.capabilities.dockSidechatOperations === true;
  const source = useQuietThreadShell(threadRef);
  const children = useQuietThreadShells().filter(
    (thread) =>
      thread.environmentId === threadRef.environmentId &&
      thread.sidechatSourceThreadId === threadRef.threadId &&
      thread.deletedAt === null,
  );
  const [model, setModel] = useState(defaultModel);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const commandId = useRef(CommandId.make(randomUUID()));
  const settings = useEnvironmentSettings(threadRef.environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(threadRef.environmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      source?.projectId ?? null,
    ),
  );
  const options = getCustomModelOptionsByInstance(
    settings,
    providers,
    model.instanceId,
    model.model,
  );
  const create = async () => {
    if (busyRef.current || !allowed || !supported) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const result = await open({
      environmentId: threadRef.environmentId,
      input: {
        commandId: commandId.current,
        sourceThreadId: threadRef.threadId,
        modelSelection: model,
        creationSource: "web",
      },
    });
    if (result._tag !== "Success") {
      busyRef.current = false;
      setBusy(false);
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : String(failure));
      return;
    }
    const childRef = scopeThreadRef(threadRef.environmentId, result.value.threadId);
    if (initialPrompt) useComposerDraftStore.getState().setPrompt(childRef, initialPrompt);
    onCreated?.();
    useRightPanelStore.getState().openSidechat(hostRef, childRef);
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Side chats</DialogTitle>
          <DialogDescription>
            Open a saved conversation, or capture the parent's current conversation in a new side
            chat. It shares the checkout and permissions. Creating it does not start an agent turn.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            {children.length ? (
              <ul className="max-h-64 space-y-1 overflow-auto">
                {children.map((thread) => (
                  <li key={thread.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                      disabled={busy}
                      onClick={() => {
                        useRightPanelStore
                          .getState()
                          .openSidechat(hostRef, scopeThreadRef(thread.environmentId, thread.id));
                        onClose();
                      }}
                    >
                      <span className="truncate">{thread.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {thread.sidechatExpiredAt ? "Expired · read-only" : "Live"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No saved side chats for this thread.</p>
            )}
            <div className="space-y-2">
              <p className="text-sm font-medium">New side chat model</p>
              <ProviderModelPicker
                environmentId={threadRef.environmentId}
                activeInstanceId={model.instanceId}
                model={model.model}
                lockedProvider={null}
                instanceEntries={entries}
                modelOptionsByInstance={options}
                disabled={busy}
                isComposerOwned={false}
                onInstanceModelChange={(instanceId, selectedModel) => {
                  commandId.current = CommandId.make(randomUUID());
                  setModel({ instanceId, model: selectedModel });
                }}
              />
            </div>
            {!supported ? (
              <p role="status" className="text-sm text-muted-foreground">
                Connect an updated environment to create a side chat.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !allowed || !supported} onClick={() => void create()}>
            {busy ? "Capturing…" : "New side chat"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
