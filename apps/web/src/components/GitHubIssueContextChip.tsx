import type { GitHubIssueContextRecord } from "@t3tools/contracts";
import { CircleDotIcon } from "lucide-react";
import { ContextChipPopover } from "./contextChipParts";

export function GitHubIssueContextChip(props: {
  record: GitHubIssueContextRecord;
  copyMarkdown?: string | undefined;
}) {
  const { record } = props;
  return (
    <ContextChipPopover
      kind="github-issue"
      icon={<CircleDotIcon />}
      label={record.label || `${record.repository}#${record.number}`}
      accessibleLabel={`GitHub issue ${record.repository}#${record.number}: ${record.title}`}
      {...(props.copyMarkdown === undefined ? {} : { copyMarkdown: props.copyMarkdown })}
    >
      <div className="max-h-96 space-y-3 overflow-y-auto p-2 text-sm">
        <div>
          <p className="font-medium">{record.title}</p>
          <p className="text-xs text-muted-foreground">
            {record.repository}#{record.number} · {record.state}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Captured {new Date(record.capturedAt).toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">
            Issue updated {new Date(record.sourceUpdatedAt).toLocaleString()}
          </p>
        </div>
        <p className="whitespace-pre-wrap break-words">{record.body || "No description."}</p>
        {record.bodyTruncated ? (
          <p className="text-xs text-muted-foreground">Description shortened in this snapshot.</p>
        ) : null}
        {record.comments.map((comment) => (
          <div key={comment.id} className="border-t border-border pt-2">
            <p className="text-xs text-muted-foreground">
              {comment.author?.login ?? "Unknown author"} ·{" "}
              {new Date(comment.createdAt).toLocaleString()}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words">{comment.body}</p>
            {comment.bodyTruncated ? (
              <p className="text-xs text-muted-foreground">Comment shortened.</p>
            ) : null}
          </div>
        ))}
        {record.omittedComments > 0 ? (
          <p className="text-xs text-muted-foreground">
            {record.omittedComments} comments omitted from this snapshot.
          </p>
        ) : null}
      </div>
    </ContextChipPopover>
  );
}
