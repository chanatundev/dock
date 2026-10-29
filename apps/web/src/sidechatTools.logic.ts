import type { RightPanelKind } from "./rightPanelStore";

export const SIDECHAT_TOOL_LABELS: Record<RightPanelKind, string> = {
  preview: "Browser",
  terminal: "Terminal",
  files: "Files",
  file: "File",
  diff: "Changes",
  device: "Device",
  "pull-request": "Code Review",
  "pull-requests": "Code Review",
};
