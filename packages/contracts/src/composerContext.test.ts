import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  COMPOSER_CONTEXT_KINDS,
  ComposerContextRecord,
  GitHubIssueContextSnapshot,
  OrchestrationMessageContext,
} from "./composerContext.ts";

const decodeRecord = Schema.decodeUnknownOption(ComposerContextRecord);
const decodeGitHubIssueSnapshot = Schema.decodeUnknownOption(GitHubIssueContextSnapshot);
const decodeContext = Schema.decodeUnknownSync(OrchestrationMessageContext);
const encodeContext = Schema.encodeUnknownSync(Schema.toCodecJson(OrchestrationMessageContext));

const base = { version: 1, contextId: "ctx_1" } as const;

const githubIssueRecord = {
  ...base,
  kind: "github-issue",
  label: "#42 Restore sessions",
  environmentId: "environment-1",
  projectId: "project-1",
  host: "github.com",
  repository: "acme/app",
  number: 42,
  url: "https://github.com/acme/app/issues/42",
  title: "Restore sessions",
  state: "open",
  sourceUpdatedAt: "2026-10-26T12:00:00.000Z",
  capturedAt: "2026-10-26T12:30:00.000Z",
  body: "Sessions disappear after a restart.",
  bodyTruncated: false,
  comments: [
    {
      id: "issuecomment-1",
      author: { login: "alice", name: "Alice", avatarUrl: null },
      url: "https://github.com/acme/app/issues/42#issuecomment-1",
      createdAt: "2026-10-26T12:10:00.000Z",
      body: "I can reproduce this.",
      bodyTruncated: false,
    },
  ],
  totalComments: 3,
  omittedComments: 2,
} as const;

const knownRecords: Record<(typeof COMPOSER_CONTEXT_KINDS)[number], Record<string, unknown>> = {
  image: {
    ...base,
    kind: "image",
    label: "checkout-error.png",
    attachmentId: "att_1",
    name: "checkout-error.png",
    mimeType: "image/png",
    sizeBytes: 1234,
  },
  file: {
    ...base,
    kind: "file",
    label: "notes.txt",
    attachmentId: "att_2",
    name: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 12,
  },
  terminal: {
    ...base,
    kind: "terminal",
    label: "Terminal 1 lines 509-514",
    terminalId: "term-1",
    terminalLabel: "Terminal 1",
    lineStart: 509,
    lineEnd: 514,
    text: "error: boom\n  at main.ts:1",
  },
  element: {
    ...base,
    kind: "element",
    label: "<Button>",
    pageUrl: "http://localhost:3000/checkout",
    pageTitle: "Checkout",
    tagName: "button",
    selector: "#pay",
    htmlPreview: '<button id="pay">Pay</button>',
    componentName: "Button",
    source: { functionName: "Button", fileName: "Button.tsx", lineNumber: 12, columnNumber: 3 },
    styles: "color: red;",
  },
  "preview-annotation": {
    ...base,
    kind: "preview-annotation",
    label: "Checkout",
    annotationId: "ann_1",
    pageUrl: "http://localhost:3000/checkout",
    pageTitle: "Checkout",
    comment: "Make this bigger",
    targetSummary: "1 selected element",
    styleChanges: ["font-size: 20px"],
    elements: [
      {
        pageUrl: "http://localhost:3000/checkout",
        pageTitle: "Checkout",
        tagName: "button",
        selector: "#pay",
        htmlPreview: "<button>Pay</button>",
        componentName: "Button",
        source: null,
        styles: "",
      },
    ],
    screenshotContextId: "ctx_2",
  },
  "review-comment": {
    ...base,
    kind: "review-comment",
    label: "ChatComposer.tsx L4118",
    sectionId: "diff-1",
    sectionTitle: "Changes",
    filePath: "apps/web/src/ChatComposer.tsx",
    startIndex: 4118,
    endIndex: 4118,
    rangeLabel: "L4118",
    text: "Why is this here?",
    diff: "+ const x = 1;",
    fenceLanguage: "diff",
    pullRequest: {
      number: 42,
      title: "Improve context chips",
      url: "https://github.com/pingdotgg/t3code/pull/42",
      headBranch: "feat/context-chips",
      baseBranch: "main",
      state: "open",
      isDraft: false,
    },
  },
  "github-issue": githubIssueRecord,
  mention: { ...base, kind: "mention", label: "@src/index.ts", path: "src/index.ts" },
  skill: { ...base, kind: "skill", label: "$pinchtab", name: "pinchtab" },
  thread: {
    ...base,
    kind: "thread",
    label: "Fix login flow",
    environmentId: "environment-1",
    threadId: "thread-1",
    title: "Fix login flow",
  },
};

describe("ComposerContextRecord", () => {
  it("round-trips a GitHub issue snapshot with separate capture and source times", () => {
    expect(Option.isSome(decodeGitHubIssueSnapshot(githubIssueRecord))).toBe(true);
    expect(Option.getOrThrow(decodeRecord(githubIssueRecord))).toEqual(githubIssueRecord);
    const wire = encodeContext({
      version: 1,
      records: [githubIssueRecord],
    });
    expect(decodeContext(wire).records).toEqual([githubIssueRecord]);
  });

  it("enforces issue snapshot bounds and consistent comment counts", () => {
    expect(Option.isSome(decodeRecord({ ...githubIssueRecord, body: "x".repeat(6_000) }))).toBe(
      true,
    );
    expect(Option.isNone(decodeRecord({ ...githubIssueRecord, body: "x".repeat(6_001) }))).toBe(
      true,
    );
    expect(
      Option.isSome(
        decodeRecord({
          ...githubIssueRecord,
          comments: [{ ...githubIssueRecord.comments[0], body: "x".repeat(1_500) }],
        }),
      ),
    ).toBe(true);
    expect(
      Option.isNone(
        decodeRecord({
          ...githubIssueRecord,
          comments: [
            {
              ...githubIssueRecord.comments[0],
              body: "x".repeat(1_501),
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      Option.isSome(
        decodeRecord({
          ...githubIssueRecord,
          comments: Array.from({ length: 12 }, (_, index) => ({
            ...githubIssueRecord.comments[0],
            id: `issuecomment-${index}`,
          })),
          totalComments: 12,
          omittedComments: 0,
        }),
      ),
    ).toBe(true);
    expect(
      Option.isNone(
        decodeRecord({
          ...githubIssueRecord,
          comments: Array.from({ length: 13 }, (_, index) => ({
            ...githubIssueRecord.comments[0],
            id: `issuecomment-${index}`,
          })),
          totalComments: 13,
          omittedComments: 0,
        }),
      ),
    ).toBe(true);
    expect(
      Option.isNone(decodeRecord({ ...githubIssueRecord, totalComments: 4, omittedComments: 2 })),
    ).toBe(true);
    expect(
      Option.isNone(decodeGitHubIssueSnapshot({ ...githubIssueRecord, totalComments: 4 })),
    ).toBe(true);
  });

  it("keeps the new kind guarded while retaining unknown future kinds", () => {
    expect(Option.isNone(decodeRecord({ ...githubIssueRecord, body: undefined }))).toBe(true);
    expect(
      Option.getOrThrow(
        decodeRecord({
          ...base,
          kind: "future-thing",
          label: "Future",
          payload: { anything: [1, 2, 3] },
        }),
      ),
    ).toEqual({
      version: 1,
      contextId: "ctx_1",
      kind: "future-thing",
      label: "Future",
      payload: { anything: [1, 2, 3] },
    });
  });

  it("keeps unknown kinds with their payload", () => {
    const decoded = decodeRecord({
      ...base,
      kind: "future-thing",
      label: "Future",
      payload: { anything: [1, 2, 3] },
    });
    expect(Option.getOrThrow(decoded)).toEqual({
      version: 1,
      contextId: "ctx_1",
      kind: "future-thing",
      label: "Future",
      payload: { anything: [1, 2, 3] },
    });
  });

  it("does not let a malformed known kind slide through as unknown", () => {
    expect(Option.isNone(decodeRecord({ ...base, kind: "image", label: "x" }))).toBe(true);
  });

  it("bounds the serialized payload of future context kinds", () => {
    const unknown = { ...base, kind: "future-thing", label: "Future" };
    expect(Option.isSome(decodeRecord({ ...unknown, payload: "x".repeat(63_998) }))).toBe(true);
    expect(Option.isNone(decodeRecord({ ...unknown, payload: "x".repeat(63_999) }))).toBe(true);
    expect(Option.isNone(decodeRecord({ ...unknown, payload: '"'.repeat(32_000) }))).toBe(true);
    expect(
      decodeContext({
        version: 1,
        records: [
          { ...unknown, payload: "x".repeat(64_000) },
          { ...knownRecords.skill, contextId: "ctx_skill" },
        ],
      }).records,
    ).toEqual([{ ...knownRecords.skill, contextId: "ctx_skill" }]);
  });
});

describe("OrchestrationMessageContext", () => {
  it("rejects aggregate context size even when each record is valid", () => {
    const record = {
      ...knownRecords["preview-annotation"],
      styleChangeDetails: Array.from({ length: 200 }, () => ({
        targetId: "target",
        selector: null,
        property: "content",
        previousValue: "x".repeat(8_000),
        value: "y".repeat(8_000),
      })),
    };
    expect(Option.isSome(decodeRecord(record))).toBe(true);
    expect(() => decodeContext({ version: 1, records: [record] })).not.toThrow();
    expect(() =>
      decodeContext({
        version: 1,
        records: Array.from({ length: 6 }, (_, index) => ({
          ...record,
          contextId: `ctx_${index}`,
        })),
      }),
    ).toThrow();
  });

  it("sends a message without the records the wire cannot carry", () => {
    const wire = encodeContext({
      version: 1,
      records: [
        decodeContext({ version: 1, records: [knownRecords.terminal] }).records[0],
        {
          ...base,
          contextId: "ctx_2",
          kind: "future-kind",
          label: "x",
          payload: { count: Number.NaN },
        },
        { ...knownRecords["review-comment"], contextId: "ctx_3", fenceLanguage: undefined },
        { ...base, contextId: "ctx_4", kind: "future-kind", label: "y", payload: { n: 1n } },
      ],
    });
    expect(decodeContext(wire).records.map((record) => record.contextId)).toEqual(["ctx_1"]);
  });

  it("rejects oversized arrays before dropping malformed records", () => {
    expect(() =>
      decodeContext({ version: 1, records: Array.from({ length: 201 }, () => ({})) }),
    ).toThrow();
  });

  it("drops undecodable records and keeps valid siblings", () => {
    const context = decodeContext({
      version: 1,
      records: [
        knownRecords.skill,
        { version: 1, kind: "image" },
        { ...knownRecords.terminal, contextId: "ctx_2" },
      ],
    });
    expect(context.records.map((record) => record.kind)).toEqual(["skill", "terminal"]);
  });

  it("rejects duplicate normalized context identities", () => {
    expect(() =>
      decodeContext({
        version: 1,
        records: [knownRecords.skill, { ...knownRecords.terminal, contextId: " ctx_1 " }],
      }),
    ).toThrow();
  });
});
