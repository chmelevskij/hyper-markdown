# hyper-markdown — Plan

A desktop app that renders Markdown / MDX into beautifully themed HTML, renders Mermaid
diagrams, and — the headline feature — lets you **highlight rendered passages, attach
comments, and export them as structured feedback for AI agents**.

The output is meant to be *fed back into coding/writing agents*: each exported comment
carries the quoted source text and its source line range so an agent can act on it
precisely.

---

## 1. Product summary

| Aspect | Decision |
| --- | --- |
| Delivery | **Tauri 2 desktop app** (native window, real filesystem access) |
| Frontend | **Vite + React 18 + TypeScript** |
| Documents | **Open local `.md` / `.mdx` files** + **drag-and-drop** (viewer/annotator, not an authoring editor) |
| Rich content | **MDX** (runtime-compiled), GFM, frontmatter, math, **Mermaid** diagrams, syntax-highlighted code |
| Headline feature | **Highlight → comment → export** to clipboard and/or `comments.md`, with quoted source + line refs |
| Theming | CSS-variable theme system, multiple built-in themes, light/dark |

### Primary user flow
1. Open or drop a Markdown/MDX file.
2. Read it as nicely themed HTML (diagrams, code, tables all rendered).
3. Select any passage → a popover lets you attach a comment.
4. Highlights persist (sidecar file) and show in a comment sidebar.
5. Click **Export for agent** → structured Markdown/JSON on the clipboard or written to a
   file, ready to paste into / be read by an AI agent.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Tauri (Rust) — native shell                                  │
│   • file open dialog            • read/write sidecar comments │
│   • drag-drop file events       • write export file           │
│   • file-change watch (reload)  • CSP / safe-mode enforcement │
└───────────────▲─────────────────────────────────────────────┘
                │ Tauri commands / events (IPC)
┌───────────────┴─────────────────────────────────────────────┐
│ Webview — Vite + React + TypeScript                          │
│                                                              │
│  DocumentLoader ─► RenderPipeline ─► RenderedDoc (DOM)       │
│                       │                  │                   │
│           remark/rehype + MDX eval       │                   │
│           + mermaid + shiki              ▼                   │
│                               AnnotationLayer (selections,   │
│                               highlights, source-line map)   │
│                                          │                   │
│  ThemeProvider          CommentStore ◄───┘   Exporter        │
│  (CSS vars)             (Zustand + sidecar)  (md / json)     │
└──────────────────────────────────────────────────────────────┘
```

### Frontend libraries
- `@mdx-js/mdx` — runtime `evaluate()` to compile MDX strings inside the webview.
- `remark-gfm`, `remark-frontmatter`, `remark-math` — Markdown extensions.
- `rehype-katex` — math; `rehype-raw` — inline HTML; custom `rehype-source-line` plugin.
- `shiki` — syntax highlighting (lazy-loaded; themes track the app theme).
- `mermaid` — diagram rendering (configured with `securityLevel: 'strict'`).
- `zustand` — app + comment state.

### Rust crates
- `tauri`, `tauri-plugin-dialog`, `tauri-plugin-fs`.
- `notify` (or Tauri fs watch) — external-edit live reload.
- `serde` / `serde_json` — sidecar + export serialization.

---

## 3. The hard part: highlight anchoring + source mapping

Selections must (a) survive re-renders and reloads and (b) report **source line numbers**
so agents get precise references. MDX transforms content, so we solve this in two layers:

1. **Source-line stamping** — a custom `rehype-source-line` plugin reads each node's
   `node.position` (line/column from the parser) and stamps
   `data-src-start` / `data-src-end` on block-level elements. A selection inside an element
   can then report the source line range.

2. **Text-quote anchoring** — store a W3C-style anchor for each highlight: exact `quote`,
   short `prefix`/`suffix` context, and a `start`/`end` text-position fallback. On reload we
   re-locate the range from the quote (robust to edits), falling back to position.

3. **Rendering highlights** — prefer the **CSS Custom Highlight API** (no DOM mutation;
   supported in the recent WebKit that ships with current macOS) with a `<mark>`-wrapping
   fallback for older webviews.

### Data model
```ts
interface Comment {
  id: string;
  documentPath: string;
  createdAt: string; updatedAt: string;
  body: string;                       // the user's note
  status: 'open' | 'resolved';
  tags?: string[];
  anchor: {
    quote: string;                    // exact selected text
    prefix: string; suffix: string;   // ~32 chars of context each
    start: number; end: number;       // text-position fallback (char offsets)
    sourceLineStart?: number;
    sourceLineEnd?: number;
  };
}
```

### Persistence
Sidecar JSON keyed by document. Default location: Tauri app-data dir, file name derived from
a hash of the absolute path. Option (setting): store next to the document as
`<name>.hmd-comments.json` so comments travel with the file / can be committed.

---

## 4. Export format (the agent payload)

**Markdown** (default — paste into any agent):
```md
# Review comments — docs/architecture.md
_3 open comments • exported 2026-05-25_

## 1 · lines 12–14
> the exact quoted source passage

**Comment:** Tighten this; it contradicts §2.

---
```

**JSON** (for tooling / MCP later):
```json
{ "document": "docs/architecture.md",
  "comments": [
    { "id": "...", "lines": [12,14], "quote": "...", "body": "...", "status": "open" }
  ] }
```

Both available via **Copy to clipboard** and **Write to file** (defaults to `comments.md`
beside the document; path is chooseable).

---

## 5. Security / trust

MDX executes arbitrary JS/JSX, so an opened `.mdx` file is effectively code.
- This is a **local tool on the user's own files** → opened files are trusted by default.
- **Safe mode** toggle: render MDX as plain Markdown (no JS eval), for untrusted files.
- Restrict the component/scope object passed to `evaluate()`.
- Strict Tauri **CSP**; Mermaid `securityLevel: 'strict'`.

---

## 6. Build phases

- [x] **Phase 0 — Scaffold.** Tauri 2 + Vite + React + TS. App window, dev workflow
      (`pnpm tauri dev`), base layout (toolbar / content / sidebar), theme provider.
- [x] **Phase 1 — Load documents.** Open dialog + drag-drop, read file, detect `.md` vs
      `.mdx`. Browser-fallback file picker for dev. (Recent-files list: deferred.)
- [x] **Phase 2 — Render pipeline.** MDX runtime `evaluate`, remark-gfm/frontmatter/math,
      rehype-katex, themed typography CSS, shiki code highlighting, theme switcher,
      `rehype-source-line` plugin.
- [x] **Phase 3 — Mermaid.** Render ```mermaid``` fences to SVG, theme-aware, error states.
- [x] **Phase 4 — Highlights + comments.** Selection popover, anchoring engine, source-line
      mapping, comment sidebar (list, edit, resolve, delete, select), CSS Custom Highlight
      rendering, sidecar persistence (Tauri) / localStorage (browser).
- [x] **Phase 5 — Export & import.** Structured Markdown + JSON builders, clipboard + file
      write. Import reads exported `.md` / `.json` (and full sidecar JSON) back, re-anchoring
      each comment to the current document by its quoted text.
- [x] **Phase 6 (partial) — Polish.** Safe-mode toggle, four themes, light/dark, app
      packaging (`pnpm tauri build` → `.app` + `.dmg`), resizable + collapsible comment
      sidebar (width persisted, clamped 260–620), `scrollbar-gutter: stable` to stop
      scrollbar-induced layout shift.
- [ ] **Remaining polish.** External-edit live reload, more keyboard shortcuts,
      jump-to-highlight scroll, "unanchored" badge for imported comments whose quote isn't
      found, strict CSP.

### Verified (browser preview, Chrome DevTools MCP)
Render pipeline (frontmatter, GFM task lists, tables, math), Mermaid SVG, Shiki highlighting,
text selection → comment with correct source-line ref, CSS-highlight painting, highlight
persistence across theme/mode recompiles, and the agent Markdown export payload.

---

## 7. Open decisions / defaults (revisit if needed)
- Package manager: **pnpm**.
- State: **Zustand**.
- Code highlighting: **shiki** (quality) — fall back to rehype-highlight if bundle size hurts.
- Sidecar location default: **app-data dir** (toggle to store beside file).
- No authoring editor in v1 (viewer/annotator only) — could add a split editor later.
