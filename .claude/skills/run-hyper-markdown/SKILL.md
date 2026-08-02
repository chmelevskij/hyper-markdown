---
name: run-hyper-markdown
description: >-
  Build, launch, screenshot and drive the hyper-markdown desktop app. Use when
  asked to run, start, build, test, screenshot, or interact with hyper-markdown
  — including verifying UI changes, comment/highlight behaviour, Mermaid
  diagram-part comments, or the Tauri desktop build.
allowed-tools: Bash, Read
---

# Run hyper-markdown

Tauri 2 + React 19 desktop app. Paths below are relative to the repo root.

**The agent path is the browser preview, driven by
`.claude/skills/run-hyper-markdown/driver.mjs` over the Chrome DevTools
Protocol.** The frontend deliberately runs in a plain browser too
(`src/platform/index.ts` swaps native file I/O for the File API +
localStorage), and that is the *only* surface you can drive: on macOS the Tauri
window is a WKWebView, which has neither CDP nor WebDriver — `tauri-driver`
does not support macOS at all.

The driver has **zero dependencies** (Node 22's global `WebSocket` speaks CDP
directly). It starts vite if needed, launches headless Chrome, runs commands
from stdin, and tears both down.

## Prerequisites

Node 22+, pnpm, and Google Chrome (or Chromium). For the desktop build, Rust.

```bash
pnpm install --frozen-lockfile
```

Chrome is auto-located at `/Applications/Google Chrome.app/...`,
`/usr/bin/google-chrome`, `/usr/bin/chromium`. Override with `CHROME_PATH`.

## Run — agent path

Pipe newline-separated commands to the driver. It prints each command and its
result, and exits non-zero if any command failed.

```bash
node .claude/skills/run-hyper-markdown/driver.mjs <<'EOF'
open docs/AGENT_STEERING.md
eval __store.getState().tabs[0].comments.length
shot /tmp/hmd.png
EOF
```

### Commands

| command | effect |
| --- | --- |
| `open <path>` | load a real file from disk via the store (see Gotchas) |
| `seed <path>` | preload that doc's `*.hmd-comments.json` into localStorage — run **before** `open` |
| `goto [url]` | navigate (defaults to the app) |
| `shot <file>` | PNG screenshot to `<file>` |
| `eval <js>` | evaluate in the page; awaits promises, prints JSON |
| `text <sel>` | `innerText` of the first match (first 800 chars) |
| `wait <sel> [ms]` | poll until the selector exists |
| `click <sel>` | **real** mouse press/release at the element centre |
| `domclick <sel>` | `el.click()` — needed inside `.doc-scroll` (see Gotchas) |
| `select <sel>` | select the element's text and fire the `mouseup` that opens the comment popover |
| `type <sel> <text>` | set a React-controlled input's value properly |
| `keys <combo>` | e.g. `Escape`, `Meta+c` |
| `size <w> <h>` | viewport override |
| `sleep <ms>` / `console` | pause / dump collected console + page errors |

Flags: `--headed` (visible Chrome), `--url`, `--port`, `--timeout`.

### Verified smoke test

Text comments and reading mode — works on `main`:

```bash
node .claude/skills/run-hyper-markdown/driver.mjs <<'EOF'
open docs/AGENT_STEERING.md
select .markdown-body p
type .sel-popover__input smoke test comment
domclick .sel-popover .btn--primary
eval __store.getState().tabs[0].comments[0].body
click .seg__btn:first-child
eval __store.getState().viewMode
click .seg__btn:nth-child(2)
shot /tmp/hmd-smoke.png
console
EOF
```

Prints `"smoke test comment"` then `"reading"`, and exits 0. **Look at the
screenshot** — the commented passage is highlighted with a matching sidebar card.

### Diagram-part comments

Clicking inside a Mermaid diagram to comment on one node/edge is a *separate
feature*. On a branch that lacks it, the click is inert and `.sel-popover` never
appears — that is the feature being absent, not the driver failing. Where it is
present:

```bash
node .claude/skills/run-hyper-markdown/driver.mjs <<'EOF'
open docs/AGENT_STEERING.md
click .markdown-body svg g.node
type .sel-popover__input rename this node
domclick .sel-popover .btn--primary
eval JSON.stringify(__store.getState().tabs[0].comments.at(-1).anchor.part)
eval document.querySelectorAll('.part-mark__pin').length
EOF
```

Returns e.g.
`{"block":"L14","kind":"node","key":"flowchart-app-0","path":"1/12/3/0","label":"…"}`
and a pin count of 1 — the part is tinted with a numbered pin matching its card.

## Run — human path (real desktop app)

```bash
pnpm tauri dev          # ~24s incremental Rust build, then a native window
```

Useful only with a display — it opens a real macOS window that you cannot drive
programmatically. Verify it came up with `pgrep -f "target/debug/hyper-markdown"`.
Stop with `pkill -f "target/debug/hyper-markdown"; pkill -f "tauri.js dev"`.

Release bundle: `pnpm app:build`. macOS install + `hmd` CLI: `pnpm app:install`.

## Build / check

```bash
pnpm build              # tsc && vite build — ~7s; the only correctness gate
pnpm lint:commits       # conventional-commit check (jj repo — see CLAUDE.md)
```

There is no test suite. `pnpm build` typechecks; the driver is the behavioural check.

## Gotchas

- **Vite binds IPv6 only.** `vite.config.ts` sets `host: false`, so it listens on
  `[::1]:1420`. A `127.0.0.1` probe never sees it — check over HTTP, not raw TCP.
- **`pnpm dev` does not forward SIGTERM.** Killing the pnpm wrapper leaves vite
  holding :1420, and `strictPort: true` makes the *next* run die with "Port 1420
  is already in use". The driver spawns `node_modules/.bin/vite` directly to
  avoid this. Vite takes ~1s to exit — don't check the port immediately.
- **The browser preview ignores `*.hmd-comments.json` sidecars.** Only the Tauri
  build reads them; the browser stores comments in
  `localStorage['hmd:comments:<absolute path>']`. Use `seed` before `open`.
- **Seeded `docs/AGENT_STEERING.md` comments are all `resolved`**, and
  `showResolved` defaults to false — so the sidebar looks empty and
  `.comment-card` count is 0. That is correct filtering, not a bug. Reveal them
  with `eval __store.getState().toggleShowResolved()`.
- **You cannot open files through the UI.** The browser build uses a synthetic
  `<input type="file">` click, which CDP can't satisfy. `open` goes through
  `window.__store.getState().loadDocument()` instead. `__store` only exists
  under `import.meta.env.DEV`, so this needs `pnpm dev`, never a preview build.
- **Use `domclick`, not `click`, for the comment popover.** `.doc-scroll` has
  `onMouseDown={() => pending && setPending(null)}`, so a real mousedown
  destroys the pending selection before the Save button ever sees it.
- **React controlled inputs ignore `el.value = "x"`.** `type` goes through the
  native `value` setter then dispatches `input`.
- **Selections need a `mouseup`.** `DocumentView` captures them in `onMouseUp`,
  not `selectionchange`. That's what `select` dispatches.
- **No `data-testid` anywhere** — select by BEM class: `.sel-popover__input`,
  `.comment-card`, `.seg__btn`, `.markdown-body`, `.part-mark__pin`.
- **Mermaid ids are per-render** (`mmd-<hash>`, nodes `mmd-<hash>-flowchart-app-0`).
  Never hardcode them; use `.markdown-body svg g.node` or `[data-et="edge"]`.
- **AppleScript can't enumerate the native window** — `osascript` returns "not
  allowed assistive access". Use `pgrep` to confirm the desktop app is up.

## Troubleshooting

| symptom | fix |
| --- | --- |
| `Port 1420 is already in use` / `timed out waiting for vite` | orphaned vite: `kill $(lsof -ti:1420)` |
| `no __store — is this a production build?` | driver needs the dev server; don't point `--url` at a preview build |
| `no Chrome/Chromium found` | `export CHROME_PATH=/path/to/chrome` |
| `selector not found within 15000ms` | Shiki/Mermaid still rendering — add `sleep 500` before the assertion |
| `'.foo,' is not a valid selector` | `type` splits on whitespace: its selector must not contain spaces |
