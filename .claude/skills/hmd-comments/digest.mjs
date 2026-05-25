#!/usr/bin/env node
/**
 * hmd-comments digest — a token-efficient view over hyper-markdown sidecars.
 *
 *   node digest.mjs [list] [dir] [--all]   list open (or all) comments
 *   node digest.mjs resolve <id> [dir]     mark a comment resolved + re-baseline
 *
 * Reference-only by design: it prints file + line range + note, never the
 * quoted source, so an agent that already has the repo gets zero duplication.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SIDECAR_SUFFIX = ".hmd-comments.json";

// ---- helpers --------------------------------------------------------------

/** cyrb53 — must match src/lib/changes.ts so re-baselines agree with the app. */
function hashSource(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function findSidecars(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "target") continue;
      out.push(...findSidecars(full));
    } else if (e.name.endsWith(SIDECAR_SUFFIX)) {
      out.push(full);
    }
  }
  return out;
}

function docPathFor(sidecarPath) {
  return sidecarPath.slice(0, -SIDECAR_SUFFIX.length);
}

function lineLabel(anchor) {
  const s = anchor?.sourceLineStart;
  if (s == null) return "L?";
  const e = anchor?.sourceLineEnd;
  return e && e !== s ? `L${s}–${e}` : `L${s}`;
}

function oneLine(s) {
  return (s || "").replace(/\s+/g, " ").trim() || "(no note)";
}

function loadSidecar(path) {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(data?.comments) ? data : null;
  } catch {
    return null;
  }
}

// ---- commands -------------------------------------------------------------

function cmdList(dir, includeResolved) {
  const sidecars = findSidecars(dir);
  const groups = [];
  let openCount = 0;
  let shownCount = 0;

  for (const sc of sidecars) {
    const file = loadSidecar(sc);
    if (!file) continue;
    const doc = docPathFor(sc);
    const rel = relative(process.cwd(), doc) || doc;
    const rows = [];
    for (const c of file.comments) {
      if (c.status === "open") openCount++;
      if (!includeResolved && c.status !== "open") continue;
      shownCount++;
      rows.push(
        `  [${String(c.id).slice(0, 8)}] ${lineLabel(c.anchor).padEnd(8)} ${
          c.status === "resolved" ? "(resolved) " : ""
        }${oneLine(c.body)}`,
      );
    }
    if (rows.length) groups.push(`${rel.split(sep).join("/")}\n${rows.join("\n")}`);
  }

  if (shownCount === 0) {
    console.log(includeResolved ? "No review comments found." : "No open review comments found.");
    return;
  }

  const header = includeResolved
    ? `Review comments — ${shownCount} shown (${openCount} open)`
    : `Review comments — ${openCount} open`;
  console.log(`${header}\n\n${groups.join("\n\n")}\n`);
  console.log("Resolve when addressed:");
  console.log("  node .claude/skills/hmd-comments/digest.mjs resolve <id>");
}

function cmdResolve(idPrefix, dir) {
  if (!idPrefix) {
    console.error("Usage: digest.mjs resolve <id> [dir]");
    process.exit(2);
  }
  const sidecars = findSidecars(dir);
  const matches = [];
  for (const sc of sidecars) {
    const file = loadSidecar(sc);
    if (!file) continue;
    for (const c of file.comments) {
      if (String(c.id).startsWith(idPrefix)) matches.push({ sc, file, comment: c });
    }
  }

  if (matches.length === 0) {
    console.error(`No comment id starts with "${idPrefix}".`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`Ambiguous id "${idPrefix}" — matches ${matches.length} comments. Use a longer prefix.`);
    process.exit(1);
  }

  const { sc, file, comment } = matches[0];
  const now = new Date().toISOString();
  comment.status = "resolved";
  comment.updatedAt = now;

  // Re-baseline to the current document so a reopened comment reads "untouched".
  const doc = docPathFor(sc);
  try {
    const source = readFileSync(doc, "utf8");
    if (comment.baseline) {
      comment.baseline.docHash = hashSource(source);
      comment.baseline.capturedAt = now;
    }
  } catch {
    /* document not found next to sidecar — resolve without re-baselining */
  }

  file.version = 2;
  writeFileSync(sc, `${JSON.stringify(file, null, 2)}\n`);
  const rel = relative(process.cwd(), doc) || doc;
  console.log(`Resolved [${String(comment.id).slice(0, 8)}] in ${rel.split(sep).join("/")}.`);
}

// ---- entry ----------------------------------------------------------------

const args = process.argv.slice(2);
const includeResolved = args.includes("--all");
const positional = args.filter((a) => !a.startsWith("--"));
const cmd = positional[0] === "list" || positional[0] === "resolve" ? positional[0] : "list";

if (cmd === "resolve") {
  cmdResolve(positional[1], positional[2] || process.cwd());
} else {
  // `list [dir]` or just `[dir]`
  const dir = positional[0] === "list" ? positional[1] || process.cwd() : positional[0] || process.cwd();
  let target = dir;
  try {
    if (!statSync(target).isDirectory()) target = process.cwd();
  } catch {
    target = process.cwd();
  }
  cmdList(target, includeResolved);
}
