# Superseded Dock expansion decisions

Historical record only. The current delivery authority is [decisions.md](decisions.md).
These earlier choices do not authorize rebuilding deferred feature families.

# Dock v1 decisions

This is Dock's durable decision record, requested by the project owner. Decisions
below describe intended behavior, not implementation or verification status. Update
an affected decision when it changes instead of appending a competing account.
Routine implementation choices are made with engineering judgment; significant
changes to ownership, execution, permissions, or user workflows need discussion.

T3 is the execution, transport, and multi-client foundation. Synara supplies product
behavior and UI references where compatible. The initial comparison used Synara
`29b11e105200c7bc6e2c71a06a375513d4c8a72d`; later comparisons used
`3f55b77ef186764050ecf4edd6ae0879eec948a8` and inspected files at
`257b4de84410571a16ef5bd562debf4c1aa3c9fb`. Attribution remains with adapted code
and [Synara's license](../third-party-notices/synara/LICENSE).

## Current delivery scope — D66, 2026-10-29

The owner's scope clarification supersedes the broader feature-port scope below.
Dock v1 is focused on:

- `/side` conversations alongside existing work.
- Hubs that group existing projects, with Void for ungrouped projects.
- Sidebar navigation with provider/account usage.
- T3's existing pull-request review view.
- T3's built-in scheduled tasks, exposed as Automations.
- A daily Inbox with Tasks and handoff into ordinary T3 threads.

Hubs in this scope are project groups: use the existing Space membership model
under that product name, rather than requiring a separate managed project,
coordinator, Library, or supervisor. D03/D06 describe the reusable membership and
reveal behavior. The separate Hub model in D46–D49, D58, D61, and D63–D65 is
deferred, including the assignment snapshot work started under that model.

The GitHub Issues expansion and a separate Synara-style automation backend or
activity dashboard are deferred. Automations reuses T3's existing scheduled-task
screen and records. Existing T3 PRs, scheduling, remote connections, and execution remain
the foundation. Task handoff should reuse T3's thread launch/send paths; it does
not require autonomous Hub supervision. The preceding native-mobile approval
applies to the retained core destinations; GitHub Issues is outside this reduced
scope. Earlier decisions record the broader design and do not make deferred
features prerequisites for this delivery. Existing implementation work is
preserved while its integration is reconciled with this scope.

### Maintenance boundary — D67

Dock should remain a small product layer over T3. Reuse T3's projects, threads,
provider adapters, scheduler, credentials, connection ownership, and PR review.
Keep Dock grouping, Inbox derivation, navigation, and usage presentation in
feature modules, with small explicit integration points. Prefer derived views
over another canonical store. A new persisted record needs a user-owned fact
that cannot be derived from T3 state.

Necessary `/side` lifecycle and context changes are a bounded exception: keep
their core hooks small and cover those hooks with focused regression tests.
Do not spread Dock-specific branches through individual provider adapters or
copy upstream screens merely to restyle them. Keep branding at product display
boundaries rather than renaming upstream symbols and packages.

Before extending the fork, reconcile the current diff with D66 and remove
integration of deferred features. Preserve existing work and data during that
contraction. For Task handoff, evaluate the smallest durable Task/thread link
before retaining exclusive claims, remote completion outboxes, or distributed
Hub context delivery; the latter are not automatic requirements of an Inbox.
This is the maintenance direction, not a claim that cleanup is implemented.

### Built-in Automations — D68

Automations remains in the reduced scope. It is a navigation entry for T3's
existing scheduled tasks, permissions, webhooks, controls, and run delivery. Reuse
the existing scheduled-task screen and services rather than maintaining a second
activity query, dashboard, or scheduler. This retains the requested workflow and
T3's upstream fixes without importing Synara's separate automation model.

## Ownership and navigation

| ID  | Dock decision and reason                                                                                                                                                                                                                                 | Relationship to T3 / Synara                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 | Each environment owns its database, projects, threads, files, provider credentials, and execution state. Aggregate views use environment-scoped identities; never synchronize SQLite between machines.                                                   | Preserves T3's remote architecture; extends Synara's primarily server-local views across environments.                                                    |
| D02 | Keep T3 Connect, Tailscale/direct connections, native mobile, provider adapters, Sidekick, `/pipeline`, and `/goal`.                                                                                                                                     | Dock extends T3 rather than replacing its execution or connection architecture with Synara's.                                                             |
| D03 | A Space belongs to one environment. A project belongs to at most one Space; Void means no membership and has no stored identity. Filter membership before checkout grouping. Deleting a Space returns projects to Void.                                  | Adapts Synara organization without modifying T3's canonical project aggregate.                                                                            |
| D04 | Wide web/desktop uses a slim feature rail, the existing project/thread sidebar with Spaces/Void, and top view tabs. Destinations are Inbox, Tasks, Code Review, Automations, and Hubs. Narrow web puts those destinations in the existing sidebar sheet. | Adapts Synara's rail while retaining T3's project tree, responsive sheet, native window controls, and panel layout. Native mobile navigation is separate. |
| D05 | Save ordered open-view references in the client profile; restore after restart and mount only the active view. Closing a tab closes its view without stopping, archiving, or deleting work.                                                              | Adapts Synara workspace tabs to T3's environment-scoped routes and subscriptions; layouts are not synchronized between clients.                           |
| D06 | Explicit tab/history/palette/link navigation to a thread outside the selected Space reveals it through All projects. Manually changing Spaces leaves the current thread open.                                                                            | Extends T3's existing hidden-project reveal behavior to the Synara-style Space filter.                                                                    |
| D07 | Ship frosted blur/vibrancy with platform fallbacks. Defer native AppKit Liquid Glass.                                                                                                                                                                    | Synara's blur is the compatible reference; no native main-process bridge or exception to T3's process isolation is approved.                              |
| D08 | Motion must communicate state, respect reduced motion, and avoid continuous repainting.                                                                                                                                                                  | Keeps T3's performance constraints while adapting Synara's spatial UI behavior.                                                                           |

## Canonical Tasks

| ID  | Dock decision and reason                                                                                                                                                                                                                            | Relationship to T3 / Synara                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| D09 | Tasks are standalone records with list and board views. A separate Threads board displays ordinary threads. A Task can exist without a project or thread.                                                                                           | Preserves Synara's distinction between personal Tasks and thread cards; T3 threads remain execution records.                              |
| D10 | A Task stays authoritative where created, even when it executes in another environment/project. Links carry environment-scoped IDs; interrupted launch/link operations remain pending and recoverable.                                              | Extends Synara assignment across T3 environments without transferring Task identity.                                                      |
| D11 | The execution environment enforces one active Task claim per thread across all owners. Completed Tasks retain historical links.                                                                                                                     | Retains Synara's one-open-Task rule at the machine that owns execution.                                                                   |
| D12 | Only an explicit user action or authorized Task tool completes a Task. A finished provider turn surfaces work for review.                                                                                                                           | Synara-style explicit lifecycle remains distinct from T3's provider-turn completion.                                                      |
| D13 | Support complete/reopen and archive/restore, preserving linked threads and assignment history. Reopen/restore reclaims the old thread only if available; otherwise the Task opens unassigned.                                                       | Adds reversible archive to Synara's simpler deletion workflow without deleting T3 work. Permanent deletion, if exposed, must be explicit. |
| D14 | Unassign, reassign, complete, or archive releases the active claim and cancels pending assignment. Preserve the old thread and history; running work continues until explicitly stopped there.                                                      | Task organization does not implicitly cancel T3 execution.                                                                                |
| D15 | A Task's project label is independent of its execution project/environment. Adopt the execution project as the label only if no label exists. Display both clearly.                                                                                 | Retains Synara's organizational label behavior while making T3's execution ownership visible.                                             |
| D16 | Server agents/automations create durable remote assignment requests. A connected Dock client relays them through its existing sessions and grants; local execution can recover headlessly. Remote work waits while suitable clients are closed.     | Preserves T3's client-owned connections; no new paired server-to-server runtime.                                                          |
| D17 | Persist an issuing agent's permission ceiling and enforce it again at execution. Raised target permissions block a pending request for review. User assignments use explicitly chosen permissions.                                                  | Extends T3's immediate agent permission checks to deferred Synara-style assignment.                                                       |
| D18 | Assignment offers explicit Queue or Steer. Queue sends the captured prompt as the next ordinary turn; Steer requires a steerable running turn. Do not silently substitute one mode.                                                                 | Exposes T3's distinct dispatch semantics in the Task workflow.                                                                            |
| D19 | Derive Task columns from assignment and live activity: To do, Working, Needs you, Review, Done. Moving to Working opens assignment; Done explicitly completes; To do unassigns without stopping old work. Needs you/Review reflect actual activity. | Adapts Synara's activity-derived board to canonical Tasks without adding a competing manual stage.                                        |
| D20 | One Tasks tab owns a detail pane, selected by environment and Task in the URL. Linked threads open in ordinary thread tabs.                                                                                                                         | Adapts Synara's detail pane to T3 routing without a top tab per Task.                                                                     |
| D21 | Remote agent completion is a durable request bound to the current Task, assignment, and caller thread. Relay through a connected client; stale assignments cannot complete reopened or reassigned Tasks.                                            | T3 MCP callers mutate their local environment; the relay reaches the canonical Task owner safely.                                         |
| D22 | Show Pending, Completed, or Stale in the executing thread's Task panel, with a link to the owner. Settling a request does not start another agent turn.                                                                                             | Adds persistent feedback for deferred remote completion instead of injecting messages into T3 execution.                                  |
| D23 | Task execution targets durable ordinary threads only, including reclaim and delayed assignment. Exclude live and expired side chats.                                                                                                                | Synara-style temporary conversations must not become a canonical Task's expiring execution dependency.                                    |

## Inbox and Code Review

| ID  | Dock decision and reason                                                                                                                                                                                | Relationship to T3 / Synara                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| D24 | Derive one Inbox from connected environments, preserving T3's environment-owned read watermark and showing availability. Recap boundaries use the viewing client's timezone at 04:00 / 12:00 / 18:00.   | Adapts Synara's attention/recap experience without creating a second canonical inbox or server timezone setting.                                     |
| D25 | Attention and Task lists sit beside the daily recap, stacked on narrow screens. Thread groups open ordinary thread tabs; Task rows open the Tasks detail pane.                                          | Reuses Synara's layout and T3's canonical navigation destinations.                                                                                   |
| D26 | Finished, never-opened threads count as unread in Inbox, web/desktop sidebar, and native mobile. Use the existing visit protocol.                                                                       | Chooses Synara's unread rule over T3's previous first-visit prerequisite; imported unvisited completions may show badges.                            |
| D27 | Code Review has separate Pull Requests and GitHub Issues tabs. Preserve T3's PR reviews, comments, guides, actions, and six source-control hosts.                                                       | Adapts Synara's Issues inbox without replacing T3's multi-host PR implementation.                                                                    |
| D28 | Issue reads/writes use each project's owning environment's T3 GitHub credentials, request policy, and rate limits; aggregate in the client.                                                             | Reuses T3 services rather than Synara's separate `gh` CLI transport. Different environments can have different access to the same repository.        |
| D29 | Default to each project's preferred GitHub remote. Offer Include upstream remotes and environment/project filters.                                                                                      | Retains Synara's fork-focused repository selection inside T3's environment ownership.                                                                |
| D30 | Issue pins belong to environment-owned projects, keyed by host/repository/issue number. Checkouts pin independently and all clients see the same pins.                                                  | Adapts Synara's project/repository pin behavior; T3's PR surface has no equivalent shared issue-pin store.                                           |
| D31 | After four minutes or explicit refresh, perform a full GraphQL read. Preserve rate-limit backoff and last-good results.                                                                                 | Intentionally drops Synara's cheap REST ETag probe: the newest REST item cannot prove both the full Issues window and Involving me search unchanged. |
| D32 | Send to agent opens a reviewable ordinary-thread draft. Ask opens an issue-scoped `/side`. Both use a selected project/environment and captured issue context; neither starts a turn merely by opening. | Retains both Synara actions through T3's draft and side-chat paths.                                                                                  |
| D33 | Issue context has a dedicated composer card across clients: identity, source update time, capture time, bounded description/comments, and explicit refresh.                                             | Uses T3's typed composer context envelope rather than copying Synara's legacy prompt-block representation or using a Markdown file.                  |
| D34 | Refresh inside Ask stages a newly captured issue card for the next user message. Sending records the newer reference; the original opening snapshot stays immutable and readable.                       | Extends Synara's refresh workflow through T3 composer drafts, with no automatic provider turn or snapshot replacement.                               |

## `/side`

| ID  | Dock decision and reason                                                                                                                                                                                                                                                                          | Relationship to T3 / Synara                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D35 | A side chat is a marked T3 v2 thread with source/context/expiry metadata. It is distinct from a fork and Sidekick.                                                                                                                                                                                | Adapts Synara's thread-based side chats to T3 v2 commands, events, transcript recovery, and normal provider startup.                                                            |
| D36 | Give it an independent provider thread/native conversation within T3's existing session pool. Inherit parent model, permissions, and checkout by default; allow model choice. Shared checkout edits affect both conversations.                                                                    | Preserves Synara inheritance and T3 multiplexing; does not mean a dedicated process/session per side chat.                                                                      |
| D37 | Freeze all visible items committed when opening, including partial output from an active turn. Store an independent immutable snapshot in the side chat's environment, surviving parent edits/deletion.                                                                                           | Avoids T3's native-fork active-run restriction. Snapshot storage is independent because T3 handoff records require a run/provider thread that an empty pane does not yet have.  |
| D38 | On the first turn, deliver frozen context through T3's normal handoff budget. Make the complete snapshot readable in bounded pages on demand.                                                                                                                                                     | Reuses T3 context delivery/token budgeting instead of injecting unbounded transcript text into a prompt or thread shell.                                                        |
| D39 | Copy referenced uploaded/generated assets into side-chat ownership; expose them on demand. Parent deletion must not remove copied assets.                                                                                                                                                         | Extends text-only T3 handoff with durable snapshot asset ownership. Arbitrary workspace files are not implicitly copied.                                                        |
| D40 | **Engineering judgment:** already missing historical assets become explicit Unavailable entries; copy every present asset and preserve frozen text. A genuine copy/storage failure remains an error with rollback.                                                                                | Tolerates incomplete older T3 transcripts without pretending assets exist or losing available copies. This resolves the missing-asset choice delegated to engineering judgment. |
| D41 | Expiry is environment-owned: one hour of inactivity by default, with 24 hours or never. Viewing, active/queued work, pending requests, and relevant background work pause expiry. Expire durably, unload only this native conversation, revoke its MCP credential, retain a read-only transcript. | Adapts Synara's expiry policy to T3's v2 execution and shared-session architecture.                                                                                             |
| D42 | Web/desktop leases follow visible mounted views. Native mobile leases follow a focused thread screen while the app is foregrounded; release on blur/background/unmount. Expired mobile transcripts remain read-only with recoverable unsent text.                                                 | Gives Synara-style lifecycle protection to T3's separate native client instead of blocking mobile access.                                                                       |
| D43 | Put parent-thread `/side` and issue Ask in host right-panel tabs, with an option to open the same conversation in a top tab. Narrow screens use a full-width pane with Back.                                                                                                                      | Adapts Synara's host dock to T3's Browser/Terminal/review panel system.                                                                                                         |
| D44 | Host panels list live and expired side chats. Omit them from the general project tree and Threads board; include their questions/approvals in Inbox. Top tabs remain available.                                                                                                                   | Keeps Synara's compact discovery model while preserving T3 attention handling.                                                                                                  |
| D45 | Returning selected/reviewed text to the parent is explicit and queues an ordinary message. No automatic return and no implicit steering.                                                                                                                                                          | Uses T3's queue dispatch rather than treating side-chat output as parent instructions.                                                                                          |

## Hubs, Automations, and provider showcase

| ID  | Dock decision and reason                                                                                                                                                                                                                                                                                | Relationship to T3 / Synara                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D46 | A Hub, its instructions/Library, and owned Tasks belong to one environment. Adding an existing Task requires that same owner; execution may target any connected environment.                                                                                                                           | Adapts Synara's Hub organization without cross-environment entity ownership or Task identity transfer.                                       |
| D47 | Represent a Hub separately, with one managed ordinary T3 project for its coordinator/Library. That workspace appears in Void until assigned to a Space.                                                                                                                                                 | Separates Synara's special project container from T3's requirement that coordinator threads have a project.                                  |
| D48 | Workers receive versioned instructions and selected Library file snapshots at assignment. Later changes require explicit refresh.                                                                                                                                                                       | Replaces Synara's live local file reads with portable context so remote work continues while the owner/client is offline.                    |
| D49 | Automatic supervision is per-Hub and off by default. Status and rollups always update; enabling supervision queues coalesced coordinator follow-ups for results/attention.                                                                                                                              | Preserves Synara supervision while making T3 provider use an explicit choice.                                                                |
| D50 | T3's scheduler remains authoritative for schedules, webhooks, permissions, run delivery, and existing MCP tools. Adapt Synara's dashboard, history, attention, and controls around those same records.                                                                                                  | Explicitly rejects a second Synara canonical automation model or schedule migration. Synara-only execution options need deliberate adapters. |
| D51 | Pin any number of grouped provider-account rings, using T3's email/fingerprint/workspace matching. The rail scrolls when the pinned rings do not fit. Details show environments and availability. Accounts without reliable identity stay environment-scoped; selections belong to this client profile. | The owner removed Synara's two-ring cap. Grouping still avoids duplicate subscription rings across machines.                                 |
| D52 | Keep the fork baseline current while preserving Dock edits. The approved fast-forward to `725840de835e163b50496863491a5d911ea812d0` removes visible Nightly branding without changing the update channel.                                                                                               | Accepts T3/Dock upstream branding behavior rather than introducing a separate release-channel change.                                        |

## Additional engineering decisions

**D53 — Pane input ownership.** With parent and side-chat views both mounted,
keyboard and paste actions belong to the focused pane. Body-focused input and
portaled controls follow the most recently used pane; closing the child returns
ownership to the parent. T3's window listeners previously assumed one chat view.
Adapting Synara-style embedding requires this boundary so input cannot land in the
wrong conversation. This is an engineering judgment within the approved layout.

**D54 — Automation history provenance.** History is derived from T3's accepted
scheduler-tagged messages and their run projections, rather than a new Synara
automation ledger. Scheduler delivery success and an agent finishing work remain
different states. This follows the approved T3 scheduler foundation and avoids
making the dashboard a second authority.

**D55 — Showcase quota presentation and refresh.** Initially each account ring
shows its most constrained reported quota window; details retain every reported
window and environment availability. Automatic reads use T3's existing coalescing
and five-minute cooldown while the client is visible. This adapts Synara's rings
without adding a separate polling/credential path or silently summing unlike
quota windows. Account selections stay in the client profile.

**D56 — Automation dashboard reads and cancellation.** The workspace reads the
existing environment-owned scheduled-task feed. Each visible automation reads only
its newest compact history row; the selected detail reads 25 rows at a time.
Visible views refresh at minute boundaries and offer explicit refresh. Closing the
view releases these reads. Cancel targets the exact accepted run and leaves other
queued turns available; pausing controls future schedule delivery. This adapts
Synara's dashboard to T3's existing command boundaries rather than treating a
schedule's delivery receipt as the outcome of agent work.

**D57 — Side-chat tool routing.** Browser, Terminal, files, and review tools opened
from an embedded side chat use sibling tabs in the host's right panel. Every tab
retains and labels the child environment/checkout; changing host selection must
not retarget an existing tool. This adapts Synara's nearby tools to T3's panel
architecture without nesting another panel inside the side chat.

**D58 — Hub archive and restore.** Archive hides the Hub and disables automatic
supervision, while preserving its Tasks, Library, coordinator, managed workspace,
and running workers. Restore leaves supervision off until explicitly enabled.
This replaces Synara's destructive deletion with a reversible lifecycle and keeps
T3 thread execution independent of organization changes.

**D59 — Hosted tools retain their canonical child surfaces.** A host tool tab stores
only the child environment/thread and original surface ID. The child retains T3's
Browser/Terminal/file/review state and permission checks. Closing a hosted tool
uses the source conversation's resource controls; closing the side-chat view
continues to leave its work alone. Embedded route context is explicit so tools do
not accidentally read the host URL's project. This is an implementation adaptation
of D57, avoiding duplicate tool sessions or a separate Synara execution path.

**D60 — Slash-command draft handling.** `/side` opens the host's side-chat launcher.
A question after the command is staged in a newly created side chat's composer;
it does not start a provider turn. The parent draft is cleared only after capture
succeeds and only if it still matches the submitted text. Cancelling or failing
capture preserves the draft. Attachments stay in the parent until the user opens
the side chat and adds them there. This adapts Synara's quick side-question entry
to T3's reviewable drafts and keeps command text from being sent to the parent.

**D61 — Managed Hub creation is resumable.** Capture the complete creation intent
before allocating the workspace, project, and empty coordinator. Stable IDs and
T3's normal command receipts allow a retry to finish the same Hub after a partial
failure. Retain partially created work rather than deleting it during recovery.
Creating a Hub does not start a provider turn. This adapts Synara's managed Hub
workspace to T3's project/thread services without another scheduler or execution
path; the Hub remains the metadata authority.

**D62 — Issue Ask host and execution identity.** An issue's side-chat panel is
keyed by source environment, GitHub host, repository, and issue number, independent
of the selected local checkout. The execution project is chosen separately and
retained by the child thread and its tool tabs. Saved live and expired side chats
remain discoverable at that issue. On wider screens the issue detail stays beside
the conversation, with the issue list hidden while the panel is open; narrow
screens use the approved full-width panel with Back. This adapts Synara's issue
dock to T3's environment-scoped thread and panel stores without inventing a server
thread to represent the issue itself.

**D63 — Managed Hub repository boundary.** Initialize a separate Git repository
inside each new managed Hub workspace before registering its T3 project. A T3
home inside a checkout would otherwise make Git discover that enclosing repository
and misidentify the Hub's files and remotes. Do not create commits, copy remotes,
or replace an existing repository. This keeps the approved managed ordinary
project self-contained and reuses T3's VCS provisioning service, rather than
allowing Synara's special-container behavior to leak into the enclosing checkout.

**D64 — Task membership is organization, not execution.** A Task can be created
inside an active Hub or added later without changing its identity. Membership
changes are normal revision-guarded metadata edits in the Task's owner environment;
only active Hubs in that same authority can receive Tasks. Detaching remains
available after Hub archive. Moving a Task does not release its claim, stop its
thread, or silently replace an assignment's captured context. This applies the
approved Hub ownership rule to T3's existing Task command/history path rather than
moving Synara chat or project records.

**D65 — Frozen Hub files retain their bytes.** Assignment captures keep an
independent copy of each explicitly selected Library file, including binary
files, alongside versioned instructions and a content manifest. Reuse T3's
attachment file/count limits and transfer bytes on demand through the existing
connected-client sessions; keep bodies out of list feeds. A completed capture is
immutable across retries and survives changes or deletion of the managed source
workspace. Missing selected files block capture so the selection can be reviewed;
paths outside the Library and repository metadata cannot enter the snapshot.
This adapts Synara's local Library reads to the approved offline worker snapshot
model without relying on the owner filesystem during later worker turns.

## Native feature navigation

The owner approved native feature destinations, then narrowed delivery through
D66. Native implementation should follow that retained core scope and reuse the
shared environment-owned state, alongside the already approved unread,
issue-card compatibility, and `/side` lifecycle behavior.
