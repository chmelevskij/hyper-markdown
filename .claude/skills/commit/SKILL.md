---
name: commit
description: >-
  Describe and split the current work into Conventional Commits using jj
  (Jujutsu). Use when the user asks to commit, save, or check in work in this
  repo — the release version and CHANGELOG are generated from these
  descriptions, so the format is load-bearing.
allowed-tools: Bash, Read, Grep, Glob
---

# Commit (jj + Conventional Commits)

Releases here are fully derived from commit descriptions: release-please reads
the commits on `main`, picks the next version, and writes `CHANGELOG.md` from
them. The description *is* the release note — write it for someone reading the
changelog in six months, not for the diff.

**This repo uses jj, not git.** It's colocated, so `git` commands appear to
work; using them anyway fights the tool and confuses the working-copy state.
Never `git add` or `git commit` here.

**jj has no commit-msg hook**, so nothing catches a bad description at write
time. Getting it right here is the enforcement; `pnpm lint:commits` and CI are
the backstops.

## The jj model, in one paragraph

The working copy is itself a commit, `@`. Every edit you make is already "in" it
— there is no staging area and nothing to add. You give `@` a description
(`jj describe`), and optionally peel parts of it off into separate commits
(`jj split`). `jj commit` is just "describe `@`, then start a new empty change
on top".

## Workflow

### 1. Look

```bash
jj status                 # files changed in @
jj diff                   # the actual changes
jj log                    # where @ sits in the stack
```

Read the diff properly. The type depends on what the change *does* for a user,
not on which directory it touched.

### 2. Decide the split

One commit per coherent change — would these lines belong under the same
changelog heading?

- A feature plus an unrelated fix found along the way → **two commits**
  (`feat:` and `fix:`), or the fix vanishes from Bug Fixes.
- A feature plus the refactor that enabled it → usually **one** `feat:`.
- Docs/CI/formatting that rode along → split out as `docs:` / `ci:` / `style:`.

### 3. Split, oldest commit first

`jj split -m "<msg>" <paths>` moves those paths into a **new parent commit**
with that message; everything else stays in `@`. So each split emits the next
commit in history order — peel off the earliest first, then describe the
remainder last.

```bash
jj split -m "ci: add release and CI workflows" .github release-please-config.json
jj split -m "build: validate commit descriptions" scripts .githooks package.json
jj describe -m "docs: document the commit convention"      # whatever's left
```

Verify as you go with `jj log` and `jj diff -r <rev> --summary`.

If a single file genuinely holds two unrelated changes, say so and describe it
once under the dominant type rather than contriving a split — `jj split -i`
needs an interactive diff editor, which isn't available here.

### 4. Write the description

```
type(scope): subject

why this change exists, what it replaces, anything surprising

BREAKING CHANGE: only if behaviour someone depends on changed
```

- **type** — see the table in `CLAUDE.md`. `feat` bumps the minor, `fix` the
  patch, `!`/`BREAKING CHANGE` the major (minor while pre-1.0).
- **scope** — lowercase area, optional but preferred: `mermaid`, `comments`,
  `anchors`, `store`, `export`, `tabs`, `theme`, `cli`, `tauri`, `ci`.
- **subject** — imperative, lowercase, ≤ 72 chars including the prefix, no
  trailing period. "add X", not "adds X" / "added X".
- **body** — optional; explain *why* (the diff shows what). `-m` accepts
  embedded newlines, so a multi-line description works as one argument.

### 5. Check

```bash
pnpm lint:commits         # validates trunk()..@
```

Fix anything it flags with `jj describe -r <change-id> -m "…"` — descriptions
are freely editable in jj, no amend/rebase dance needed.

### 6. Report

Show `jj log` for what you produced and say which changelog section each commit
lands in. **Don't push unless asked.** If asked: place the bookmark first
(`jj bookmark set <name> -r @-`), then `jj git push`.

## Judgement calls

- **Nothing user-visible changed?** Not a `feat`. Internal cleanups are
  `refactor`, build wiring is `build`, workflow files are `ci`.
- **Starting fresh work** — `jj new main` rather than piling onto an unrelated
  stack. If `@` already sits on a pushed feature bookmark and the new work is
  independent, say so and offer to re-root it.
- **Reverting** — `revert: <original subject>` with the reverted change id in
  the body.
- **Version bumps** — never hand-edit `package.json`, `tauri.conf.json`,
  `Cargo.toml` versions, `CHANGELOG.md`, or `.release-please-manifest.json`.
  release-please owns them.
- **`jj undo`** reverses the last jj operation if a split goes wrong — prefer it
  to manual repair.
