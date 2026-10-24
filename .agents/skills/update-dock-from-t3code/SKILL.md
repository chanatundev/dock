---
name: update-dock-from-t3code
description: Use when updating, syncing, or pulling the dock fork up to date with upstream T3 Code (pingdotgg/t3code), resolving merge conflicts between the fork and upstream, or when dock is missing recent upstream fixes and features.
---

# Update dock from T3 Code

dock (`chanatundev/dock`) is a fork of T3 Code (`pingdotgg/t3code`) whose
history contains upstream. Update it with a **merge** of the newest upstream
**nightly tag** (`v<semver>-nightly.<date>.<run>`), not `upstream/main` HEAD:
every nightly is a commit upstream CI built and published, and dock carries
that tag's version so its sidebar can tell when a newer nightly is out. Upstream
cuts stable releases from nightly commits on `main`, so the tags sit on `main`'s
history and the merge-base flow is the same as merging `main`.
Never rebase fork commits and never force-push: `main` is published, and a merge
keeps every later sync's merge-base correct.

## 1. Preflight

```bash
git status --short                      # must be clean apart from untracked noise
git remote get-url upstream 2>/dev/null \
  || git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream main --tags && git fetch origin main
git switch main && git merge --ff-only origin/main
TAG=$(git for-each-ref --sort=-creatordate --count=1 --format='%(refname:short)' 'refs/tags/v*-nightly.*')
VERSION=${TAG#v}
git merge-base --is-ancestor $TAG upstream/main  # must succeed; nightlies are cut from main
git merge-base --is-ancestor $TAG HEAD && echo "already up to date"  # → stop
MB=$(git merge-base HEAD $TAG)
git rev-list --count HEAD..$TAG            # upstream commits this sync brings in
git log --oneline --no-merges $MB..HEAD    # fork-only commits to protect
```

`gh release view $TAG -R pingdotgg/t3code` should show a published nightly. If
the newest nightly tag has no published release (its build failed), use the
previous one.

If the working tree has uncommitted work that isn't yours, stop and ask. Don't
stash or discard it.

## 2. Preview conflicts without touching the tree

```bash
git merge-tree --write-tree --name-only HEAD $TAG
```

The lines after the tree hash are conflicted files. Before resolving each one, read
`git log --oneline $MB..HEAD -- <file>` and `git log --oneline $MB..$TAG -- <file>`
so you know what each side meant to do.

Also scan `git log --oneline --no-merges $MB..$TAG` for upstream features
that overlap a fork feature. Collect every open question from this step, check
it against [When to ask](#when-to-ask), and ask them all in one batch before
you start the merge.

## 3. Merge on a sync branch

```bash
git switch -c sync/t3code-$VERSION
git merge --no-ff --no-commit $TAG
```

Resolve every conflict with the rules below, then stamp the merged nightly's
version into the release packages (server, desktop, web, contracts) and refresh
the lockfile:

```bash
node scripts/update-release-package-versions.ts $VERSION
vp i
```

Upstream commits only stable versions and stamps nightly versions in CI, so this
step is what makes dock report `$VERSION`. It is required even when nothing
conflicted. Commit when `git diff --name-only --diff-filter=U` is empty and no
`<<<<<<<` markers remain.

## Resolution rules

The default is to keep **both** sides: take upstream's change and re-apply the
fork's intent on top of it. Take one side wholesale only when a row below says so.

| Area                                                                                                                                             | Rule                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fork features (sidekick, `/goal`, `/pipeline`, computer-use MCP tools, issue-link context, web settled-project shortcuts, DiffPanel walkthrough) | Keep them. `/goal` uses v2 metadata and carries into upstream's native forks and provider handoffs. Adopt upstream's MCP thread tools; do not restore fork `/fork`, `/handoff`, or `start_thread`. Port other features to upstream's shape. Listed in `README.md` under "Fork-specific additions".                                        |
| Branding                                                                                                                                         | User-visible name stays **dock**: `apps/desktop/package.json` `productName`, desktop `APP_BASE_NAME`, `apps/desktop/resources/branding/*`, icon paths in `DesktopAssets.ts` and `scripts/build-desktop-artifact.ts`.                                                                                                                      |
| Nightly update track                                                                                                                             | The update-track selector stays removed. If upstream edits nightly channel code (`apps/desktop/src/updates/*`, `DesktopAppSettings.ts`, update IPC channel, update-track UI in `SettingsPanels.tsx`), keep the fork's single-channel updater. Nightly _versioning_ is expected: the app is "dock (Nightly)" with the nightly sidebar art. |
| `version` in `apps/{server,desktop,web}/package.json`, `packages/contracts/package.json`                                                         | Always the merged tag's `$VERSION`. Upstream's `chore(release): prepare vX` commits conflict here every sync; the stamp step settles them.                                                                                                                                                                                                |
| Upstream nightly notice (`apps/web/src/upstreamNightly.ts`, `SidebarUpstreamNightlyPill.tsx`, its switch in `SidebarChrome.tsx`)                 | Keep. If upstream reworks `SidebarUpdatePill`, keep dock rendering the notice in its place.                                                                                                                                                                                                                                               |
| `README.md`                                                                                                                                      | Keep the fork's version.                                                                                                                                                                                                                                                                                                                  |
| `AGENTS.md`, `docs/`, `.repos/`                                                                                                                  | Take upstream's version unless it has fork-specific edits.                                                                                                                                                                                                                                                                                |
| `pnpm-lock.yaml`                                                                                                                                 | `git checkout --theirs pnpm-lock.yaml`, then `vp i` to regenerate it. Stage the result.                                                                                                                                                                                                                                                   |
| IPC channels, contracts, settings schemas                                                                                                        | Union both sides' entries. Don't drop an upstream channel, and don't drop a sidekick channel either.                                                                                                                                                                                                                                      |
| Mobile (`apps/mobile`)                                                                                                                           | Take upstream's version wholesale. Fork settled-project shortcuts are web only; do not rebrand mobile.                                                                                                                                                                                                                                    |
| Fork schema changes                                                                                                                              | Never take upstream migration ids. Use `reconcileCkcodeMigrations` or idempotent ensure steps outside the upstream ledger. Leave the legacy `projection_threads.goal` column in place; v2 goals live in thread JSON.                                                                                                                      |

Leave internal identifiers alone: the `t3` CLI, `@t3tools/*` packages,
`~/.t3`, `T3CODE_*` env vars, `t3.codes` URLs, and T3 Connect.

### Branding sweep (required, even with zero conflicts)

Upstream keeps adding new "T3 Code" UI strings, and a clean merge brings them in
silently. Before committing:

```bash
git diff HEAD -U0 -- apps/web/src apps/desktop/src ':!*.test.*' \
  | grep -E '^\+\+\+ |^\+.*T3 Code' | grep -B1 '^+[^+]' | grep -v '^--$'
```

It prints each file header followed by its new "T3 Code" lines.

For each user-visible hit:

- **Web** (`apps/web/src`): wrap the string with `appBrandCopy(...)` from `~/branding`, or use `APP_BASE_NAME`.
- **Desktop** (`apps/desktop/src`): write `dock` literally, as the fork's existing strings do.
- Update any test that asserts the old string.

Mobile is not rebranded, so leave it.

## When to ask

If a question matches a row in the tables above, follow the table. Ask the user
only when one of these is true:

| Trigger                                                                                                                                   | Example question                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Upstream deleted or redesigned code that a fork feature depends on, and keeping the feature means re-implementing it, not just porting it | "Upstream replaced the command menu that `/pipeline` hooks into. Re-implement it, or drop it for now?" |
| Upstream shipped a feature that overlaps a fork feature                                                                                   | "Upstream added its own thread goals. Keep the fork's `/goal`, adopt upstream's, or keep both?"        |
| Both sides changed the same behavior in incompatible ways, so you can't keep both                                                         | "Both sides changed composer submit on Enter. Which behavior wins?"                                    |
| Upstream brings back something the fork removed or renamed, in a form the tables don't cover                                              | "Upstream moved update channels into a new settings page. Hide the nightly option there too?"          |
| A "T3 Code" hit might mean the upstream project rather than this app                                                                      | "'Built on T3 Code' in the About panel: rebrand it, or keep it as credit?"                             |
| Fixing a typecheck or test failure would change how a fork feature behaves, beyond a rename or signature update                           | "Sidekick prefs are now in a new settings schema. Migrate existing prefs, or reset them?"              |
| The working tree has uncommitted work that isn't yours                                                                                    | "Commit, stash, or leave these changes before syncing?"                                                |

How to ask:

- Batch questions at a checkpoint, either after the step 2 preview or after the
  first pass of resolution. Don't stop once per file.
- Use AskUserQuestion. Offer 2-4 concrete options, put your recommendation first,
  and name the file plus the fork and upstream commit subjects involved.
- While waiting, keep resolving files the questions don't affect. Don't commit
  the merge until every question is answered.
- Record each answer in the merge commit message.

## 4. Verify (targeted, never repo-wide)

For each package that had a conflict or a branding edit:

```bash
vp run --filter <@t3tools/web|@t3tools/desktop|t3|@t3tools/contracts|@t3tools/mobile> typecheck
vp test run <test files for the files you resolved>
```

Don't run `vp check`, `vp run -r typecheck`, or the full suite. CI covers those.
If a typecheck fails in a file you didn't touch, it is almost always a fork
feature that calls an API upstream renamed. Fix the fork code, not upstream's.

## 5. Commit and land

```bash
git commit    # message below
git switch main && git merge --ff-only sync/t3code-$VERSION && git branch -d sync/t3code-$VERSION
```

Commit message:

```
merge: sync upstream T3 Code <TAG> into dock

Brings in <N> upstream commits (<MB short>..<TAG>); dock is now <VERSION>.
Conflicts: <file> — <what was kept from each side>; ...
Branding: <strings rewritten to dock, or "none">
Decisions: <question — user's answer>; ... (omit if none were asked)
```

Ask before running `git push origin main`, because it publishes the fork.

## Common mistakes

- **Merging `upstream/main` HEAD.** It may hold commits no nightly has built, and dock's version would not name what it contains. Merge the nightly tag.
- **Skipping the version stamp.** dock keeps reporting the old version, and the sidebar keeps offering the nightly you just merged.
- **Rebasing onto upstream.** This rewrites 25+ published commits and breaks origin. Merge instead.
- **Resolving with `--theirs` or `--ours` on a whole file.** This silently drops the other side's feature. Use it only where the table allows it.
- **Skipping the branding sweep because nothing conflicted.** New upstream strings ship as "T3 Code".
- **Guessing on a trigger from "When to ask".** A quiet guess about a fork feature is harder to find and undo than a question.
- **Asking about something the tables already settle.** For example, "keep dock branding?" Just apply the rule.
- **Hand-merging `pnpm-lock.yaml`.** Regenerate it instead.
- **Restoring nightly UI** because upstream's `SettingsPanels.tsx` hunk looked like a clean improvement.
