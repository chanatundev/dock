# dock

**dock is a fork of [T3 Code](https://github.com/pingdotgg/t3code).** Credit and thanks go to the [T3 Code contributors](https://github.com/pingdotgg/t3code/graphs/contributors) for creating and maintaining the original project.

dock follows upstream T3 Code's nightly releases while keeping the additions below. Each sync merges the newest upstream nightly and adopts its version (for example `0.0.46-nightly.20261004.2648`). The desktop app is branded dock (Nightly); desktop SSH environments use the matching upstream `t3` release. See the [upstream README](https://github.com/pingdotgg/t3code#readme) for the original project's shared setup and features.

## What dock adds

### A floating Sidekick for agent activity

On desktop, the Sidekick summarizes agent activity across threads and connected environments. It signals when an agent is working or needs attention; click it to open the thread waiting longest, or hover to see the thread list. Use `/sidekick` to show or hide it, and choose its size and thread-list behavior in Settings.

### Guided Plan → Build → Review prompts

Type `/pipeline` to choose a provider and model for each stage. dock builds the prompt and places it in the composer for review before you send it.

### Issue details in provider context

When a message includes a supported public GitHub, GitLab, Linear, or Jira issue URL, dock adds available issue details to the provider prompt. If it cannot fetch details, it sends the link unchanged.

### Desktop control through MCP

When enabled in Integrations settings, agents can inspect and control desktop apps through MCP: read accessibility information, capture screenshots, click, type, and press keys.

### dock identity and upstream release tracking

The desktop app and installers use the dock name and icon. dock has no automatic updates; when a newer upstream nightly is available, the desktop sidebar links to it. To update, run the `update-dock-from-t3code` agent skill, then rebuild and reinstall the desktop app.

The collapsible “Settled projects” shelf is also available in current upstream T3 Code, so it is not listed as a dock-only feature.
