# hyper-markdown

A desktop app that renders **Markdown / MDX** into beautifully themed HTML, draws
**Mermaid** diagrams, and — the headline feature — lets you **highlight rendered passages,
attach comments, and export them as structured feedback for AI agents**.

Every exported comment carries the **quoted source** and its **source line range**, so an
agent can act on your review precisely.

## Features

- **Render Markdown & MDX** — runtime-compiled MDX (JSX + expressions), GFM (tables, task
  lists, strikethrough), frontmatter, and math (`$…$`).
- **Mermaid diagrams** — fenced ` ```mermaid ` blocks render to inline SVG, theme-aware.
- **Comment on diagram parts** — click a node, edge, subgraph, participant or message
  (inline or in the fullscreen viewer) to attach a comment to *that* part. Commented parts
  carry a tint and a numbered pin matching the sidebar; the export names the part and
  quotes the whole fenced block. Anchors ride on Mermaid's own ids, so they survive
  re-renders, theme flips and edits elsewhere in the diagram.
- **Syntax highlighting** — Shiki, with light/dark themes that follow the app.
- **Highlight → comment → export** — select any passage, attach a note; export all comments
  as agent-ready Markdown (or JSON) to the clipboard or a `.comments.md` file. The passage
  stays highlighted while you write, and ⌘C (or the copy icon) copies it.
- **Adjustable text column** — drag either edge of the column to set its width;
  double-click to reset. The width is remembered.
- **Import comments** — read an exported `.md`/`.json` (or a sidecar file) back in;
  comments re-anchor to the current document by their quoted text.
- **Tabs** — open multiple documents at once; each tab keeps its own comments, review
  state, and selection. Re-opening a file just activates its tab.
- **Live reload** — edits to an open file (from any editor) refresh the view instantly,
  and `edited` flags update live. The `hmd` CLI opens files in the running window.
- **Reading / Comment modes** — toggle between a plain themed reader and the full
  highlight-and-annotate experience (with a resizable comment sidebar).
- **Addressed tracking** — each comment snapshots the source it was made against;
  when the document changes, comments are flagged **untouched / edited / removed**,
  with a before→after diff and a one-click "Resolve as addressed". A "Needs review"
  filter surfaces just the comments whose text your edits touched.
- **Neobrutalist Solarized theme** — one cohesive theme with light & dark modes.
- **Safe mode** — render MDX as plain Markdown (no code execution) for untrusted files.
- **Persistent comments** — saved to a sidecar `*.hmd-comments.json` next to the document.

## How comments reach your agent

Select text → **Add comment** → **Copy for agent**. You get Markdown like:

```md
# Review comments — architecture.md
_2 comments • exported 2026-05-25_

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

## Develop

Version control is [Jujutsu](https://jj-vcs.github.io/jj/) (`jj`), colocated
with git — clone with either, but drive it with `jj`.

```bash
pnpm install

# Desktop app (the real target):
pnpm tauri dev          # release bundle: pnpm app:build

# Browser preview (fast UI iteration; file I/O falls back to the web File API
# + localStorage, export downloads a file / copies to clipboard):
pnpm dev                # http://localhost:1420
```

### Install the built app (macOS)

```bash
pnpm app:install        # builds, then (re)installs into /Applications and relaunches
```

This quits any running copy, replaces `/Applications/hyper-markdown.app` with a
fresh release build, opens it, and installs the `hmd` CLI onto your PATH
(`/usr/local/bin`, falling back to `~/.local/bin`). On other platforms, run
`pnpm app:build` and grab the bundle from `src-tauri/target/release/bundle/`.

### `hmd` CLI

```bash
hmd notes.md docs/spec.mdx   # open files (in tabs of the running window)
hmd                          # just focus / launch the app
```

`hmd` hands files to the app via macOS `open -a`, so it launches the app if needed
and reuses the running window otherwise.

## Releases

Releases are generated from commit messages — no manual version bumps, no
hand-written changelog.

1. **Describe each change** with [Conventional Commits](https://www.conventionalcommits.org):
   `jj describe -m "feat(mermaid): comment on individual diagram parts"`. See
   [CLAUDE.md](./CLAUDE.md) for the type table. jj has no hook mechanism, so
   check with `pnpm lint:commits` before pushing — CI enforces it either way.
2. **Push to `main`** (`jj bookmark set main -r @` then `jj git push`).
   `release-please` works out the next version from the
   commit types — `feat` → minor, `fix` → patch — and keeps an open
   **`chore(release): vX.Y.Z`** pull request holding the version bump and the
   generated `CHANGELOG.md`. Nothing ships until you merge it.
3. **Merge that PR.** It tags the release and triggers builds for **macOS
   (Apple Silicon)**, **Linux x86_64** and **Windows x86_64**, which attach
   their bundles to the GitHub Release.

The version lives in three files — `package.json`, `src-tauri/tauri.conf.json`
and `src-tauri/Cargo.toml` — all kept in step by `release-please-config.json`.
Don't edit them by hand.

Builds are unsigned, so macOS quarantines the `.dmg`: right-click ▸ **Open** the
first time, or `xattr -dr com.apple.quarantine /Applications/hyper-markdown.app`.

## Architecture

See [PLAN.md](./PLAN.md). In brief:

- **Tauri 2 (Rust)** — native window, file dialogs, OS drag-drop, file I/O for documents
  and sidecar comment files (`src-tauri/src/lib.rs`).
- **Vite + React + TypeScript** — UI, render pipeline, and the annotation engine.
- **Render pipeline** (`src/lib/render.ts`) — `@mdx-js/mdx` `evaluate()` + remark/rehype
  plugins, including a custom `rehype-source-line` that stamps source line numbers onto
  rendered elements.
- **Annotation engine** (`src/lib/anchor.ts`) — W3C-style text-quote anchors (robust to
  edits/re-renders) plus the CSS Custom Highlight API for painting highlights without
  mutating the DOM.

The frontend runs in both Tauri and a plain browser via a platform abstraction
(`src/platform/index.ts`), which keeps UI iteration and automated verification fast.
