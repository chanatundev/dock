import type { GitHubIssueContextRecord } from "@t3tools/contracts";

import {
  formatComposerContextReference,
  projectComposerContextForProvider,
} from "./composerContextReferences.ts";

export function githubIssueContextReferenceText(record: GitHubIssueContextRecord): string {
  return projectComposerContextForProvider({
    text: formatComposerContextReference(record),
    records: [record],
  });
}
