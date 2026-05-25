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
- **Syntax highlighting** — Shiki, with light/dark themes that follow the app.
- **Highlight → comment → export** — select any passage, attach a note; export all comments
  as agent-ready Markdown (or JSON) to the clipboard or a `.comments.md` file.
- **Import comments** — read an exported `.md`/`.json` (or a sidecar file) back in;
  comments re-anchor to the current document by their quoted text.
- **Resizable, collapsible comment sidebar** — drag to resize, toggle to hide/show.
- **Themes** — Paper, GitHub, Midnight, Contrast — each with light & dark modes.
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
```

Paste it into Claude Code (or any agent) and it has precise, line-anchored instructions.

## Develop

```bash
pnpm install

# Desktop app (the real target):
pnpm tauri dev          # release bundle: pnpm tauri build

# Browser preview (fast UI iteration; file I/O falls back to the web File API
# + localStorage, export downloads a file / copies to clipboard):
pnpm dev                # http://localhost:1420
```

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
