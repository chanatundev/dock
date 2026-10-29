import {
  FolderIcon,
  GitCompareIcon,
  GlobeIcon,
  PanelsTopLeftIcon,
  TerminalIcon,
} from "lucide-react";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

export function SidechatToolMenu(props: {
  browserAvailable: boolean;
  terminalAvailable: boolean;
  filesAvailable: boolean;
  diffAvailable: boolean;
  reviewAvailable: boolean;
  onBrowser: () => void;
  onTerminal: () => void;
  onFiles: () => void;
  onDiff: () => void;
  onReview: () => void;
}) {
  return (
    <div className="absolute top-0 right-2 z-20 flex h-full items-center [-webkit-app-region:no-drag]">
      <Menu>
        <MenuTrigger
          render={<Button size="icon-sm" variant="ghost" aria-label="Side-chat tools" />}
        >
          <PanelsTopLeftIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem disabled={!props.browserAvailable} onClick={() => props.onBrowser()}>
            <GlobeIcon />
            Browser
          </MenuItem>
          <MenuItem disabled={!props.terminalAvailable} onClick={() => props.onTerminal()}>
            <TerminalIcon />
            Terminal
          </MenuItem>
          <MenuItem disabled={!props.filesAvailable} onClick={() => props.onFiles()}>
            <FolderIcon />
            Files
          </MenuItem>
          <MenuItem disabled={!props.diffAvailable} onClick={() => props.onDiff()}>
            <GitCompareIcon />
            Changes
          </MenuItem>
          <MenuItem disabled={!props.reviewAvailable} onClick={() => props.onReview()}>
            <PullRequestGlyph.pullRequest />
            Code Review
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}
