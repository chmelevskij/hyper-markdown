# hyper-markdown — working notes

Tauri 2 + React 19 desktop app for reviewing Markdown/MDX: renders documents,
draws Mermaid diagrams, and lets you attach comments to passages *and* to
individual diagram parts, then export them as agent-ready feedback.

## Version control: jj, not git

**This repo uses [Jujutsu](https://jj-vcs.github.io/jj/) (`jj`).** It is
*colocated* with git — there is a real `.git` directory and git commands appear
to work — which makes reaching for `git add` / `git commit` an easy mistake.
Don't. Use jj for every VCS operation; git is only how the repo talks to GitHub.

What's different from git, and why it changes the workflow:

- **The working copy is a commit.** `@` is a real commit that updates as you
  edit. There is no staging area, no `git add`, no "unstaged changes".
- **Describing is separate from committing.** `jj describe -m "…"` sets the
  message on `@`. `jj commit -m "…"` describes `@` *and* starts a fresh empty
  change on top.
- **Splitting is a first-class operation.** `jj split -m "…" <paths>` is
  non-interactive and beats git's staging dance — see below.
- **Bookmarks, not branches.** They don't move automatically; you place them
  (`jj bookmark set <name> -r @-`) and push them (`jj git push`).

```bash
jj status                       # what's in @
jj diff                         # the actual changes
jj log                          # the stack
jj describe -m "feat(x): …"     # name the current change
jj commit -m "feat(x): …"       # name it and start a new one
jj split -m "ci: …" <paths>     # peel those paths off into their own commit
jj new main                     # start fresh work on top of main
jj bookmark set <name> -r @-    # point a bookmark at the last real commit
jj git push                     # push bookmarks
jj undo                         # undo the last jj operation
```

`jj split` puts the **selected paths into the parent** commit with the message
you gave, and leaves the remainder in `@` keeping its old description. So
repeated splits emit commits in the order you split them — split the earliest
commit first, then describe whatever's left as the final one.

## Commits — Conventional Commits, always

**Every commit description must be a Conventional Commit.** This is not a style
preference: the release pipeline reads these to decide the next version number
and to write `CHANGELOG.md`. A description that doesn't parse is silently
dropped from the release notes; the wrong type bumps the wrong digit.

```
type(scope)!: subject

optional body explaining why, wrapped at ~72 columns

BREAKING CHANGE: what consumers must do differently
```

| type | use it for | changelog |
| --- | --- | --- |
| `feat` | a user-visible capability | **Features** (bumps minor) |
| `fix` | a user-visible bug fix | **Bug Fixes** (bumps patch) |
| `perf` | faster/lighter, same behaviour | Performance |
| `refactor` | restructuring, no behaviour change | Refactors |
| `docs` | README, CHANGELOG, skill docs, comments | Documentation |
| `build` | bundling, dependencies, Tauri config | Build & Tooling |
| `ci` | GitHub Actions, release plumbing | Build & Tooling |
| `style` | formatting only | hidden |
| `test` | tests only | hidden |
| `chore` | housekeeping that fits nowhere else | hidden |
| `revert` | undoes a previous commit | Reverts |

Rules: header ≤ 72 chars, imperative mood, lowercase subject, no trailing
period, blank line before the body. Scope is optional and lowercase — the area
touched: `mermaid`, `comments`, `anchors`, `store`, `export`, `tabs`, `theme`,
`cli`, `tauri`, `ci`. A `!` after the type (or a `BREAKING CHANGE:` footer)
marks a breaking change.

Good:

```
feat(mermaid): comment on individual diagram parts
fix(store): keep column width within bounds after a reset
docs: describe the release flow
feat(export)!: drop the v1 sidecar format
```

Prefer several small typed commits over one `chore: updates`. If a change set
spans a feature *and* an unrelated fix, `jj split` it — they belong in different
changelog sections.

### Checking them

**jj has no hook mechanism**, so nothing rejects a bad description as you write
it. Two backstops instead:

```bash
pnpm lint:commits          # validates trunk()..@ locally — run before pushing
```

and CI, which validates every commit on a PR or pushed to `main`. CI is the hard
gate. (`.githooks/commit-msg` exists too, but it only fires for `git commit` —
irrelevant if you're using jj, which you should be.)

Use the `/commit` skill or the `committer` subagent to write these; both know
the rules above and drive jj correctly.

## Releasing

Fully automated from the commit descriptions; see `.github/workflows/release.yml`.

1. Land conventional commits on the `main` bookmark and `jj git push`.
2. release-please keeps an open **`chore(release): vX.Y.Z`** PR with the version
   bump and the generated changelog.
3. Merging that PR tags the release and kicks off the build matrix — macOS
   (Apple Silicon), Linux x86_64, Windows x86_64 — which attaches the bundles to
   the GitHub Release.

The version lives in **three** files, all bumped by release-please via
`release-please-config.json`: `package.json`, `src-tauri/tauri.conf.json`, and
`src-tauri/Cargo.toml`. Never bump them by hand. (`src-tauri/Cargo.lock` catches
up on the next `cargo` invocation — that drift is expected.)

After merging a release PR on GitHub, bring it back with `jj git fetch` and move
your local bookmark — don't recreate the release commit locally.

Because the app is unsigned, macOS marks the `.dmg` as quarantined; the release
notes tell users to right-click ▸ Open. Wiring Developer ID signing means adding
`APPLE_*` secrets and a `signingIdentity` to the bundle config.

## Commands

```bash
pnpm tauri dev          # the real target (desktop)
pnpm dev                # browser preview at :1420, fast UI iteration
pnpm build              # tsc && vite build — run this before claiming done
pnpm app:install        # build + install into /Applications (macOS)
pnpm lint:commits       # validate commit descriptions on the current stack
```

There is no test suite. `pnpm build` (which typechecks) is the gate.

## Architecture

See the Architecture section of [README.md](./README.md). Load-bearing pieces:

- `src/lib/render.ts` — MDX `evaluate()` + remark/rehype, including
  `rehype-source-line` which stamps source line numbers onto rendered elements.
- `src/lib/anchor.ts` — W3C-style text-quote anchors; highlights are painted
  with the CSS Custom Highlight API, never by mutating the DOM.
- `src/lib/diagram.ts` — addressing parts *inside* a Mermaid SVG, anchored to
  mermaid's own `data-et`/`data-id` markers so they survive re-renders.
- `src/platform/index.ts` — the Tauri/browser split that keeps `pnpm dev` usable.

Two React gotchas this codebase has already been bitten by, both worth
remembering before touching `Mermaid.tsx` or `MdxRenderer.tsx`:

- `dangerouslySetInnerHTML` is re-applied on **object identity**, so the value
  must be memoised or the SVG is re-parsed every render (wiping inline edits).
- New function identities in the MDX `components` map are new element types, so
  they remount every code block and diagram. Keep that map stable; pass
  per-render data through context instead.
