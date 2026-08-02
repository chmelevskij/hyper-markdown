#!/usr/bin/env node
/**
 * driver.mjs — drive hyper-markdown's browser preview programmatically.
 *
 * hyper-markdown is a Tauri desktop app, but its frontend deliberately runs in
 * a plain browser too (src/platform/index.ts swaps native file I/O for the File
 * API + localStorage). That browser preview is the only surface an agent can
 * actually drive: on macOS the Tauri window is a WKWebView, which has neither
 * CDP nor WebDriver, so `tauri-driver` does not support it.
 *
 * Zero dependencies. Node 22's global WebSocket speaks the Chrome DevTools
 * Protocol directly, so this adds nothing to package.json.
 *
 * Usage — commands come from stdin, one per line:
 *
 *   node .claude/skills/run-hyper-markdown/driver.mjs <<'EOF'
 *   open docs/AGENT_STEERING.md
 *   shot /tmp/doc.png
 *   eval __store.getState().tabs.length
 *   EOF
 *
 * Flags: --headed (visible window), --url <u>, --port <n>, --timeout <ms>
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

// ---- config ---------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(name);

const APP_URL = flag("--url", "http://localhost:1420");
const APP_PORT = Number(new URL(APP_URL).port || 80);
const CDP_PORT = Number(flag("--port", "9333"));
const TIMEOUT = Number(flag("--timeout", "15000"));
const HEADED = has("--headed");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- dev server -----------------------------------------------------------

function portOpen(port, host) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    sock.on("connect", () => (sock.destroy(), resolve(true)));
    sock.on("error", () => resolve(false));
    sock.setTimeout(700, () => (sock.destroy(), resolve(false)));
  });
}

async function waitForPort(port, ms, what) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await portOpen(port, "127.0.0.1")) return;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what} on :${port}`);
}

/**
 * vite.config.ts uses `host: false`, so vite binds *localhost* — which resolves
 * to IPv6 [::1] on macOS. A raw 127.0.0.1 probe never sees it. Ask over HTTP and
 * let Node's resolver pick the family.
 */
async function serverReady() {
  try {
    const res = await fetch(APP_URL, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Reuse an already-running `pnpm dev`; only start (and later kill) our own. */
async function ensureServer() {
  if (await serverReady()) {
    log(`▸ dev server already on ${APP_URL} — reusing`);
    return;
  }
  log(`▸ starting pnpm dev on ${APP_URL}`);
  // Spawn vite directly rather than through `pnpm dev`: pnpm does not forward
  // SIGTERM to its child, so killing the pnpm wrapper leaves vite holding :1420.
  // Assign before awaiting, so a startup timeout still has a handle to clean up.
  server = spawn("node_modules/.bin/vite", [], {
    stdio: ["ignore", "ignore", "pipe"],
    detached: true, // own process group
  });
  server.stderr.on("data", (d) => process.stderr.write(`  [vite] ${d}`));

  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (await serverReady()) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for vite on ${APP_URL}`);
}

// ---- chrome + CDP ---------------------------------------------------------

function chromeBinary() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `no Chrome/Chromium found. Tried:\n  ${CHROME_CANDIDATES.join("\n  ")}\nSet CHROME_PATH.`,
    );
  }
  return found;
}

async function launchChrome() {
  const bin = chromeBinary();
  const profile = mkdtempSync(join(tmpdir(), "hmd-driver-"));
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--window-size=1440,900",
    "about:blank",
  ];
  if (!HEADED) args.unshift("--headless=new", "--hide-scrollbars", "--disable-gpu");
  log(`▸ launching ${basename(bin)}${HEADED ? " (headed)" : " (headless)"}`);
  const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  proc.stderr.on("data", () => {}); // chrome is chatty on stderr; ignore
  await waitForPort(CDP_PORT, 20000, "chrome devtools");
  return proc;
}

async function pageSocketUrl() {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    try {
      const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* devtools not up yet */
    }
    await sleep(200);
  }
  throw new Error("no page target exposed by Chrome");
}

/** Minimal CDP client over Node's global WebSocket. */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.console = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ");
        this.console.push(`[${msg.params.type}] ${text}`);
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.console.push(`[pageerror] ${d.exception?.description ?? d.text}`);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error("CDP socket failed")), { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, TIMEOUT);
    });
  }

  /** Evaluate an expression; awaits promises and returns a plain JS value. */
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression: `(async () => (${expression}))()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "eval failed",
      );
    }
    return r.result.value;
  }
}

// ---- page helpers ---------------------------------------------------------

const jsq = (s) => JSON.stringify(s);

async function waitFor(cdp, selector, ms = TIMEOUT) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await cdp.eval(`!!document.querySelector(${jsq(selector)})`)) return true;
    await sleep(100);
  }
  throw new Error(`selector not found within ${ms}ms: ${selector}`);
}

async function centerOf(cdp, selector) {
  const box = await cdp.eval(`(() => {
    const el = document.querySelector(${jsq(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!box) throw new Error(`no element for ${selector}`);
  return box;
}

/** Real mouse events — what a user does, and what pointer handlers expect. */
async function realClick(cdp, selector) {
  const { x, y } = await centerOf(cdp, selector);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      clickCount: 1,
      buttons: type === "mousePressed" ? 1 : 0,
    });
  }
}

const KEYS = {
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
};

async function pressKey(cdp, combo) {
  const parts = combo.split("+");
  const name = parts.pop();
  let modifiers = 0;
  for (const m of parts) {
    const k = m.toLowerCase();
    if (k === "alt") modifiers |= 1;
    if (k === "ctrl" || k === "control") modifiers |= 2;
    if (k === "meta" || k === "cmd") modifiers |= 4;
    if (k === "shift") modifiers |= 8;
  }
  const spec = KEYS[name] ?? {
    key: name,
    code: `Key${name.toUpperCase()}`,
    keyCode: name.toUpperCase().charCodeAt(0),
  };
  for (const type of ["keyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", {
      type,
      modifiers,
      key: spec.key,
      code: spec.code,
      windowsVirtualKeyCode: spec.keyCode,
      nativeVirtualKeyCode: spec.keyCode,
    });
  }
}

// ---- commands -------------------------------------------------------------

const COMMANDS = {
  async goto(cdp, [url = APP_URL]) {
    await cdp.send("Page.navigate", { url });
    await sleep(400);
    await waitFor(cdp, "#root");
    log(`  → at ${url}`);
  },

  /**
   * Load a real file from disk. The browser build can only open files through a
   * native picker, which CDP can't drive — so go through the store instead.
   * `__store` is exposed by src/store/useStore.ts under import.meta.env.DEV.
   */
  async open(cdp, args) {
    const path = resolvePath(args.join(" "));
    const source = readFileSync(path, "utf8");
    const name = basename(path);
    const doc = {
      path,
      name,
      source,
      format: name.toLowerCase().endsWith(".mdx") ? "mdx" : "md",
    };
    const ok = await cdp.eval(`(async () => {
      if (!window.__store) return "no __store — is this a production build?";
      await window.__store.getState().loadDocument(${JSON.stringify(doc)});
      return null;
    })()`);
    if (ok) throw new Error(ok);
    await waitFor(cdp, ".markdown-body");
    await sleep(600); // let MDX + Shiki + Mermaid settle
    log(`  → opened ${name} (${source.length} bytes)`);
  },

  /**
   * Preload a document's sidecar comments. The browser build stores comments in
   * localStorage (`hmd:comments:<path>`), not in the `*.hmd-comments.json` file
   * next to the doc — only the Tauri build reads those. Run this *before*
   * `open`, since loadDocument() reads the comments as it loads.
   */
  async seed(cdp, args) {
    const docPath = resolvePath(args.join(" "));
    const sidecar = `${docPath}.hmd-comments.json`;
    if (!existsSync(sidecar)) throw new Error(`no sidecar at ${sidecar}`);
    const json = readFileSync(sidecar, "utf8");
    const n = await cdp.eval(`(() => {
      localStorage.setItem(${jsq(`hmd:comments:${docPath}`)}, ${jsq(json)});
      return JSON.parse(${jsq(json)}).comments.length;
    })()`);
    log(`  → seeded ${n} comment(s) for ${basename(docPath)}`);
  },

  async shot(cdp, [file = "screenshot.png"]) {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    const out = resolvePath(file);
    writeFileSync(out, Buffer.from(data, "base64"));
    log(`  → ${out}`);
  },

  async eval(cdp, args) {
    const value = await cdp.eval(args.join(" "));
    log(`  → ${JSON.stringify(value)}`);
  },

  async text(cdp, args) {
    const selector = args.join(" ");
    const t = await cdp.eval(
      `(document.querySelector(${jsq(selector)})?.innerText ?? "(no match)").slice(0, 800)`,
    );
    log(`  → ${t}`);
  },

  async wait(cdp, args) {
    const ms = /^\d+$/.test(args.at(-1)) ? args.pop() : null;
    const selector = args.join(" ");
    await waitFor(cdp, selector, ms ? Number(ms) : TIMEOUT);
    log(`  → found ${selector}`);
  },

  async click(cdp, args) {
    const selector = args.join(" ");
    await realClick(cdp, selector);
    await sleep(250);
    log(`  → clicked ${selector}`);
  },

  /**
   * el.click() instead of real mouse events. Needed for controls inside
   * .doc-scroll, whose onMouseDown clears the pending selection before a real
   * mousedown can reach the button.
   */
  async domclick(cdp, args) {
    const selector = args.join(" ");
    const hit = await cdp.eval(
      `(() => { const el = document.querySelector(${jsq(selector)}); if (!el) return false; el.click(); return true; })()`,
    );
    if (!hit) throw new Error(`no element for ${selector}`);
    await sleep(250);
    log(`  → domclicked ${selector}`);
  },

  /** Select an element's text and fire the mouseup DocumentView listens for. */
  async select(cdp, args) {
    const selector = args.join(" ");
    const text = await cdp.eval(`(() => {
      const el = document.querySelector(${jsq(selector)});
      if (!el) return null;
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return s.toString();
    })()`);
    if (text === null) throw new Error(`no element for ${selector}`);
    await sleep(250);
    log(`  → selected ${JSON.stringify(text.slice(0, 60))}`);
  },

  /** React controlled inputs ignore .value = x; go through the native setter. */
  async type(cdp, [selector, ...rest]) {
    const value = rest.join(" ");
    const ok = await cdp.eval(`(() => {
      const el = document.querySelector(${jsq(selector)});
      if (!el) return false;
      const proto = el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${jsq(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`no input for ${selector}`);
    log(`  → typed into ${selector}`);
  },

  async keys(cdp, [combo]) {
    await pressKey(cdp, combo);
    await sleep(200);
    log(`  → pressed ${combo}`);
  },

  async size(cdp, [w, h]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: Number(w),
      height: Number(h),
      deviceScaleFactor: 1,
      mobile: false,
    });
    log(`  → viewport ${w}x${h}`);
  },

  async sleep(_cdp, [ms]) {
    await sleep(Number(ms));
    log(`  → slept ${ms}ms`);
  },

  async console(cdp) {
    if (!cdp.console.length) return log("  → console clean");
    for (const line of cdp.console) log(`  ${line}`);
  },
};

// ---- main -----------------------------------------------------------------

let server = null;
let chrome = null;

async function cleanup() {
  try {
    chrome?.kill("SIGTERM");
  } catch {}
  if (server) {
    try {
      process.kill(-server.pid, "SIGTERM"); // whole group: pnpm + vite
    } catch {
      try {
        server.kill("SIGTERM");
      } catch {}
    }
  }
}

async function main() {
  await ensureServer();
  chrome = await launchChrome();
  const cdp = await CDP.connect(await pageSocketUrl());
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  log("▸ CDP connected");

  await COMMANDS.goto(cdp, [APP_URL]);

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let failed = false;
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [name, ...args] = line.split(/\s+/);
    const fn = COMMANDS[name];
    if (!fn) {
      console.error(`✗ unknown command: ${name} (have: ${Object.keys(COMMANDS).join(", ")})`);
      failed = true;
      continue;
    }
    log(`▸ ${line}`);
    try {
      await fn(cdp, args);
    } catch (err) {
      console.error(`✗ ${name}: ${err.message}`);
      failed = true;
    }
  }

  const errors = cdp.console.filter((l) => l.startsWith("[error]") || l.startsWith("[pageerror]"));
  if (errors.length) {
    console.error(`\n⚠ ${errors.length} console error(s):`);
    for (const e of errors.slice(0, 10)) console.error(`  ${e}`);
  }
  await cleanup();
  process.exit(failed ? 1 : 0);
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await cleanup();
    process.exit(130);
  });
}

main().catch(async (err) => {
  console.error(`✗ ${err.message}`);
  await cleanup();
  process.exit(1);
});
