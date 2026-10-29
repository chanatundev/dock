# Dock decisions

Current authority after the owner narrowed scope on 2026-10-29 (D66–D69).
Decisions describe intended behavior; verification is reported separately.
[Earlier expansion decisions](superseded-decisions.md) remain historical records.

## Product boundary

| Capability    | Dock decision                                                                                                                                                                                                                            | Relationship to T3 / Synara                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hubs and Void | Hubs group existing projects. Each project belongs to at most one environment-owned group; Void is no membership. Moving or deleting a group preserves projects and threads. Keep protocol/internal Space names to avoid renaming churn. | Reuses the implemented Space membership slice and Synara grouping. No separate Hub entity, managed project, coordinator, Library, or supervisor.      |
| Navigation    | Keep a slim feature rail, useful project/thread sidebar, existing client-local top tabs, and feature navigation in the narrow web sidebar sheet. Explicit navigation to a hidden thread reveals All projects.                            | Adapts Synara presentation around T3 routes and ordinary thread views. Closing a view never stops or deletes work.                                    |
| Usage         | Select up to two grouped provider accounts using T3 account identity and quota reports; selections stay client-local. Show availability and environment details.                                                                         | Reuses T3 usage identity and services; adapts Synara rings without another quota backend.                                                             |
| PR review     | Keep T3's existing PR view, host support, comments, guides, and actions.                                                                                                                                                                 | No separate GitHub Issues inbox or pin service in this delivery.                                                                                      |
| Automations   | Expose T3 scheduled tasks, webhooks, permissions, controls, and run delivery through the Automations destination. Reuse its existing screen.                                                                                             | T3 scheduler is authoritative; no second scheduler, activity service, or Synara dashboard backend.                                                    |
| Inbox         | Aggregate thread attention/activity and Tasks from connected environments beside a daily recap, stacked on narrow screens. Use the viewing client's local recap day and T3 read/visit state.                                             | Adapts Synara attention/recap presentation without another canonical inbox. Unvisited completions are unread across existing web/native thread lists. |
| Tasks         | Keep small environment-owned records with notes, priority, due date, project label, ordinary thread link, completion, and reversible archive. Preserve linked work through metadata changes.                                             | Task metadata is separate from T3 execution. No exclusive thread claims, assignment engine, completion outbox, or connected-client relay.             |
| Task handoff  | Open an ordinary new or existing durable thread, link the Task, and stage its title/notes for review in the normal composer. Preserve existing drafts; sending uses T3 controls and destination grants.                                  | Reuses T3 thread launch/composer. No automatic agent turn, thread stop, permission escalation, or new server connection runtime.                      |

## `/side`

A side chat is a marked T3 v2 thread, separate from forks and Sidekick. Capture
committed visible parent items, including an active turn's committed partial
output, into an independent immutable snapshot. Copy available referenced assets;
mark missing originals Unavailable. Deliver initial context through T3's normal
budgeted handoff and keep the full capture readable on demand.

Inherit the parent's checkout, model, and permissions by default, with model
choice available. Its provider conversation is independent within T3's session
pool. Use the host right panel, sibling tool tabs retaining the child's execution
context, and an ordinary thread/top-tab option. No nested tool panel system.

Keep side chats in the host list, omit them from the general project tree and
Threads board, and retain their pending questions/approvals in Inbox. Environment
expiry settings are 1h by default, 24h, or never. Foreground view leases and active
work protect expiry. Expired chats keep their transcript, become read-only, and
unload only their own conversation. Preserve implemented native foreground and
read-only parity. Side chats are not durable Task handoff targets.

## Maintenance boundary (D67)

- T3 owns execution, provider adapters, scheduling, credentials, connections,
  projects, threads, and PR review. Prefer derived views over another store.
- Keep Dock presentation and data in feature modules. Core changes need a
  concrete cross-boundary reason and focused regression coverage; `/side` is
  the necessary bounded exception, not permission for provider-specific forks.
- Retain established branding at display boundaries and leave upstream symbols
  and package names stable.
- During contraction, preserve databases, workspaces, transcripts, and ignored
  state. Remove unused code/registrations without dropping legacy tables.
- Keep shared legacy context decoding needed to replay existing frozen sidechat
  records. It does not re-enable the deferred GitHub Issues product.
- Native core destinations remain an approved product direction; contraction
  preserves existing native support and parity without adding a separate native
  execution or ownership model. Report unimplemented surfaces explicitly.

## Deferred expansion

Autonomous Hubs, Library distribution, cross-environment assignment coordination,
Task claims/completion relays, GitHub Issues/pins/agent actions, and a separate
Synara automation dashboard are outside this delivery. Their previous decisions
are superseded by the current scope. Existing T3 features remain available.

Synara reference revisions and licensing remain documented in adapted source
headers and [the retained MIT notice](../third-party-notices/synara/LICENSE).
