# hyper-markdown

A desktop app for **reviewing** Markdown and MDX. It renders documents into a themed
reader, draws **Mermaid** diagrams, and — the headline feature — lets you **highlight
passages, attach comments, and export them as agent-ready feedback**.

Every exported comment carries the **quoted source** and its **source line range**, so an
agent can act on your review precisely. You can comment on prose, on code, and on
**individual parts of a Mermaid diagram**.

## Install

Grab a bundle from the [latest release](https://github.com/frontendara/hyper-markdown/releases/latest):

| platform | files |
| --- | --- |
| macOS (Apple Silicon) | `.dmg`, `.app.tar.gz` |
| Linux x86_64 | `.AppImage`, `.deb`, `.rpm` |
| Windows x86_64 | `.msi`, `.exe` |

Builds are **unsigned**, so the OS objects the first time:

- **macOS** quarantines the `.dmg` — right-click ▸ **Open**, or
  `xattr -dr com.apple.quarantine /Applications/hyper-markdown.app`.
- **Windows** shows a SmartScreen warning — **More info** ▸ **Run anyway**.

## Features

### Rendering

- **Markdown & MDX** — runtime-compiled MDX (JSX + expressions), GFM (tables, task lists,
  strikethrough), frontmatter, and math (`$…$`, via KaTeX).
- **Mermaid diagrams** — fenced ` ```mermaid ` blocks render to inline SVG, theme-aware
  (neutral in light mode, dark in dark mode), with a readable error box when one fails to
  parse.
- **Fullscreen diagram viewer** — the **⤢** button on a diagram opens a pan/zoom stage;
  drag to pan, and the wheel zooms toward the cursor (there are zoom/reset buttons too).
  Close with **Esc**, the Close button, or a click on the backdrop.
- **Syntax highlighting** — Shiki, with light/dark themes that follow the app.
- **Heading anchors** — GitHub-style slugs, so in-document `#links` work.
- **Links that behave** — `http(s)` opens in your browser; a relative link to another
  Markdown file opens it **in a new tab**; other files are handed to the OS default app;
  a `#fragment` scrolls in place. Hovering shows the resolved target.
- **Adjustable text column** — drag either edge to resize it symmetrically, double-click
  to reset. The width is remembered.

### Reviewing

- **Highlight → comment** — select any passage and a popover captures a note. **⌘⏎** saves,
  **⌘C** (or the copy icon) copies the quoted passage, **Esc** dismisses. The passage stays
  highlighted while you write.
- **Comment on diagram parts** — click a node, edge, subgraph, participant or message
  (inline or in the fullscreen viewer) to attach a comment to *that* part. Commented parts
  carry a tint and a numbered pin matching the sidebar; the export names the part and
  quotes the whole fenced block, so the agent gets the source it needs to edit. Anchors
  ride on Mermaid's own ids, so they survive re-renders, theme flips and edits elsewhere
  in the diagram.
- **Non-destructive highlights** — painted with the CSS Custom Highlight API, so the
  rendered DOM is never mutated. Click a highlight to select its comment; select a card to
  scroll its anchor into view.
- **Addressed tracking** — each comment snapshots the source it was made against. When the
  document changes, comments are flagged **untouched / edited / removed**, with a
  before→after diff and a one-click **Resolve as addressed** that re-baselines it. A
  **Needs review** filter surfaces just the comments your edits touched.
- **Comment sidebar** — edit, resolve/reopen, delete, filter, show-resolved toggle, live
  open count. Resizable, and the width is remembered.
- **Reading / Comment modes** — a plain themed reader, or the full annotate experience.

### Documents & session

- **Tabs** — open many documents at once; each tab keeps its own comments, review state,
  selection and **scroll position**. Re-opening a path just activates its tab, and open
  tabs are restored on relaunch.
- **Live reload** — edits from any editor refresh the view instantly, and the
  untouched/edited/removed flags update with them.
- **Open from anywhere** — the open dialog, drag-and-drop, `.md`/`.mdx`/`.markdown` file
  associations, or the `hmd` CLI.
- **⌘W closes the tab**, not the window (⇧⌘W does that).

### Export & import

- **Copy for agent** — structured Markdown on the clipboard. Also **Copy JSON** and
  **Save .md**.
- **Import comments** — read an exported `.md`/`.json` (or a sidecar) back in; comments
  re-anchor to the current document by their quoted text.
- **Persistent comments** — saved to a sidecar `<name>.hmd-comments.json` next to the
  document, so they travel with the file and can be committed.

### GitHub pull requests

- **Sign in** — the toolbar's ⎇ GitHub button signs in with GitHub's device flow (a
  code to type into the browser; nothing to paste). The token is kept in the OS keychain
  and never enters the webview. A pasted token works too, and is the only option in the
  browser preview.
- **Link a document to a PR** — for a document inside a git checkout, *Link pull request*
  finds the open PR for the current branch; otherwise paste a PR URL.
- **Pull** — every review thread on that file lands as a comment anchored to the thread's
  lines at the PR head, with a baseline so edits under it are flagged like any other
  comment. Replies come along in the body; resolved threads arrive resolved.
- **Push** — comments not yet on GitHub go up as one PR review with inline comments.
  Diagram-part comments name the part and land on the fenced block. Lines outside the
  diff can't take inline comments, so those go into a single PR comment with permalinks.
- **Resolve** — resolving or reopening a pulled comment resolves or reopens the thread on
  GitHub, and vice versa on the next pull.

The GitHub App behind the sign-in is provisioned from [`infra/`](./infra/README.md).

### Safety & theming

- **Safe mode** — render MDX as plain Markdown, executing none of it, for untrusted files.
- **Neobrutalist Solarized theme** — Hanken Grotesk, a muted palette, light and dark.

## How comments reach your agent

Select text → **Add comment** → **Copy for agent**. You get Markdown like:

```md
# Review comments — architecture.md
_2 comments • exported 2026-08-02_

## 1 · lines 12–14
> the exact quoted source passage

**Comment:** Tighten this; it contradicts §2.

## 2 · lines 30–38 · diagram node “Start”
> ```mermaid
> flowchart TD
>   A[Start] --> B{Decision}
> …

**Comment:** Rename this to “Ingest”.
```

Paste it into Claude Code (or any agent) and it has precise, line-anchored instructions.

**Or skip the clipboard.** The bundled [`hmd-comments`](.claude/skills/hmd-comments/SKILL.md)
skill lets Claude Code read the sidecars directly — it emits a compact digest (file, line
range, note) instead of the verbose JSON, triages each comment into *actionable /
question / unclear*, and can reply to and resolve them in place:

```bash
pnpm comments           # list open comments under the cwd
```

## Develop

Version control is [Jujutsu](https://jj-vcs.github.io/jj/) (`jj`), colocated with git —
clone with either, but drive it with `jj`. See [CLAUDE.md](./CLAUDE.md).

```bash
pnpm install

# Desktop app (the real target):
pnpm tauri dev          # release bundle: pnpm app:build

# Browser preview (fast UI iteration; file I/O falls back to the web File API
# + localStorage, export downloads a file / copies to clipboard):
pnpm dev                # http://localhost:1420

pnpm build              # tsc && vite build — the correctness gate
```

There is no test suite. `pnpm build` typechecks; behaviour is verified by driving the real
app with the [`run-hyper-markdown`](.claude/skills/run-hyper-markdown/SKILL.md) skill,
which ships a zero-dependency Chrome DevTools Protocol driver.

**Cross-platform caveat:** Tauri uses the OS webview, so the shipped app runs **WebKit** on
macOS (WKWebView) and Linux (WebKitGTK) but **Chromium** on Windows (WebView2) — while
`pnpm dev` and the driver run Chrome. Anything engine-sensitive (the CSS Custom Highlight
API in particular) needs a real `pnpm tauri dev` check, and Linux's WebKitGTK is the one
most likely to lag.

### GitHub sign-in in a local build

Device-flow sign-in needs the GitHub App's client id at build time. Copy `.env.example` to
`.env.local` and set `VITE_GITHUB_CLIENT_ID` (an output of `pulumi up` in `infra/`). Without
it the app still works, but sign-in falls back to pasting a token. Release builds get the
id from the repository's `HMD_GITHUB_CLIENT_ID` Actions variable, which `infra/` sets.

### Install the built app (macOS)

```bash
pnpm app:install        # builds, then (re)installs into /Applications and relaunches
```

This quits any running copy, replaces `/Applications/hyper-markdown.app` with a fresh
release build, opens it, and installs the `hmd` CLI onto your PATH (`/usr/local/bin`,
falling back to `~/.local/bin`). On other platforms, run `pnpm app:build` and grab the
bundle from `src-tauri/target/release/bundle/`.

### `hmd` CLI

```bash
hmd notes.md docs/spec.mdx   # open files (in tabs of the running window)
hmd                          # just focus / launch the app
```

`hmd` hands files to the app via macOS `open -a`, so it launches the app if needed and
reuses the running window otherwise.

## Releases

Releases are generated from commit messages — no manual version bumps, no hand-written
changelog. See [CHANGELOG.md](./CHANGELOG.md).

1. **Describe each change** with [Conventional Commits](https://www.conventionalcommits.org):
   `jj describe -m "feat(mermaid): comment on individual diagram parts"`. See
   [CLAUDE.md](./CLAUDE.md) for the type table. jj has no hook mechanism, so check with
   `pnpm lint:commits` before pushing — CI enforces it either way.
2. **Push to `main`** (`jj bookmark set main -r @` then `jj git push`). `release-please`
   works out the next version from the commit types — `feat` → minor, `fix` → patch — and
   keeps an open **`chore(release): vX.Y.Z`** pull request holding the version bump and the
   generated `CHANGELOG.md`. Nothing ships until you merge it.
3. **Merge that PR.** It tags the release and triggers builds for **macOS (Apple Silicon)**,
   **Linux x86_64** and **Windows x86_64**, which attach their bundles to the GitHub
   Release.

The version lives in three files — `package.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml` — all kept in step by `release-please-config.json`. Don't edit them
by hand.

## Architecture

**Tauri 2 (Rust)** is the native shell — window and menu, file dialogs, OS drag-drop, file
I/O for documents and sidecars, and a `notify` watcher per open document that drives live
reload (`src-tauri/src/lib.rs`). **Vite + React 19 + TypeScript** does everything else.

```
document ─► render pipeline ─► rendered DOM
                 │                  │
   MDX evaluate() + remark/rehype   │
   + mermaid + shiki                ▼
                         annotation layer (anchors,
                         highlights, source-line map)
                                    │
  theme (CSS vars)   comment store ◄┘        exporter
                     (zustand + sidecar)     (md / json)
```

Load-bearing pieces:

- **`src/lib/render.ts`** — `@mdx-js/mdx` `evaluate()` plus remark-gfm / frontmatter /
  math, rehype-katex, rehype-raw, and two local plugins: `rehype-heading-ids` and
  `rehype-source-line`.
- **`src/lib/anchor.ts`** — the hard part. Highlights must survive re-renders, reloads and
  edits *and* report source line numbers, which MDX compilation would otherwise destroy.
  Two layers solve it: `rehype-source-line` stamps every block element with
  `data-src-start`/`data-src-end` taken from the parser's node positions, and each comment
  stores a W3C-style **text-quote anchor** — the exact quote plus ~32 characters of
  prefix/suffix context, with a character-offset fallback — that is re-located against the
  live DOM on every render.
- **`src/lib/diagram.ts`** — addressing parts *inside* a Mermaid SVG. Element ids carry a
  fresh per-render prefix, so parts are keyed on mermaid's own `data-et`/`data-id` markers,
  with a structural child-index path and the visible label as fallbacks.
- **`src/store/useStore.ts`** — zustand: tabs, comments, preferences, persistence.
- **`src/platform/index.ts`** — the Tauri/browser split that keeps `pnpm dev` (and the
  automated driver) usable without the native shell.

The comment, anchor and sidecar shapes are defined and commented in **`src/types.ts`**.

## Known gaps

- **No CSP.** `tauri.conf.json` sets `csp: null`. MDX executes arbitrary JSX, so an opened
  `.mdx` file is effectively code — the app treats your own files as trusted, and **safe
  mode** is the mitigation for anything else.
- **The `hmd` CLI and the OS open-file handoff are macOS-only.** Linux and Windows build
  and run, but opening files from the command line there needs single-instance argv
  forwarding, which isn't wired up.
- **Imported comments carry no baseline** (pulled ones do), so they get no
  untouched/edited/removed badge. A comment whose quote no longer appears in the document
  falls back to highlighting the blocks rendered from its source lines, or is dropped when
  it has none.
- **GitHub sync is on demand.** Pull and push are buttons, not a live connection, and a
  pulled comment's body is only refreshed from GitHub while you haven't edited it locally.
