import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  SidechatExpiry,
  SidechatIssueContext,
  SidechatSource,
  SidechatLaunchSource,
} from "./sidechat.ts";

const issueContext = {
  kind: "github-issue",
  sourceEnvironmentId: "environment:issues",
  projectId: "project:issue-owner",
  host: "github.com",
  repository: "team/repo",
  number: 42,
  title: "Fix the upload flow",
  url: "https://github.com/team/repo/issues/42",
  updatedAt: "2026-10-25T12:00:00.000Z",
} as const;

const isLaunchSource = Schema.is(SidechatLaunchSource);
const isCapturedSource = Schema.is(SidechatSource);

describe("Sidechat contracts", () => {
  it("validates a captured issue card against its source identity", () => {
    const reference = {
      version: 1,
      kind: "github-issue",
      contextId: "issue-opening",
      label: "Issue 42",
      environmentId: issueContext.sourceEnvironmentId,
      projectId: issueContext.projectId,
      host: issueContext.host,
      repository: issueContext.repository,
      number: issueContext.number,
      title: issueContext.title,
      url: issueContext.url,
      state: "open",
      capturedAt: issueContext.updatedAt,
      sourceUpdatedAt: issueContext.updatedAt,
      body: "Description",
      bodyTruncated: false,
      comments: [],
      totalComments: 0,
      omittedComments: 0,
    };
    expect(isLaunchSource({ kind: "github-issue", context: issueContext, reference })).toBe(true);
    expect(
      isLaunchSource({
        kind: "github-issue",
        context: issueContext,
        reference: { ...reference, number: 43 },
      }),
    ).toBe(false);
    expect(
      isLaunchSource({
        kind: "github-issue",
        context: issueContext,
        reference: { ...reference, environmentId: "other-machine" },
      }),
    ).toBe(false);
    expect(
      isLaunchSource({
        kind: "github-issue",
        context: issueContext,
        reference: { ...reference, body: "x".repeat(6001) },
      }),
    ).toBe(false);
  });
  it("allows launch callers to omit server-owned capture boundaries while persisted sources require them", () => {
    const request = { kind: "thread", threadId: "parent" };
    expect(isLaunchSource(request)).toBe(true);
    expect(isLaunchSource({ kind: "github-issue", context: issueContext })).toBe(true);
    expect(isCapturedSource(request)).toBe(false);
  });
  it("preserves the existing inactivity choices", () => {
    const isExpiry = Schema.is(SidechatExpiry);
    expect(["1h", "24h", "never"].every(isExpiry)).toBe(true);
    expect(isExpiry("12h")).toBe(false);
  });

  it("accepts scoped GitHub issue provenance and rejects incomplete or oversized context", () => {
    const isIssueContext = Schema.is(SidechatIssueContext);
    expect(isIssueContext(issueContext)).toBe(true);
    expect(isIssueContext({ ...issueContext, number: 0 })).toBe(false);
    expect(isIssueContext({ ...issueContext, sourceEnvironmentId: " " })).toBe(false);
    expect(isIssueContext({ ...issueContext, projectId: undefined })).toBe(false);
    expect(isIssueContext({ ...issueContext, title: "" })).toBe(false);
    expect(isIssueContext({ ...issueContext, title: "a".repeat(2_049) })).toBe(false);
    expect(isIssueContext({ ...issueContext, url: "" })).toBe(false);
    expect(
      isIssueContext({ ...issueContext, url: `https://example.com/${"a".repeat(2_049)}` }),
    ).toBe(false);
  });

  it("accepts thread snapshots and issue sources while rejecting corrupt references", () => {
    const isSource = Schema.is(SidechatSource);
    expect(
      isSource({
        kind: "thread",
        threadId: "thread:source",
        snapshotSequence: 0,
        capturedAt: "2026-10-25T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isSource({
        kind: "github-issue",
        context: issueContext,
        capturedAt: "2026-10-25T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isSource({
        kind: "thread",
        threadId: "thread:source",
        snapshotSequence: -1,
        capturedAt: "2026-10-25T12:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isSource({
        kind: "thread",
        snapshotSequence: 1,
        capturedAt: "2026-10-25T12:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isSource({
        kind: "github-issue",
        context: { ...issueContext, projectId: "" },
        capturedAt: "2026-10-25T12:00:00.000Z",
      }),
    ).toBe(false);
  });
});
