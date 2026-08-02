#!/usr/bin/env node
/**
 * Conventional Commits validator.
 *
 * The release pipeline derives the next version and the entire CHANGELOG from
 * commit descriptions (see .github/workflows/release.yml), so a malformed one
 * isn't a style nit — it silently drops the change from the release notes, or
 * bumps the wrong digit.
 *
 * This repo is jj (colocated with git), and **jj has no hook mechanism**, so
 * nothing can reject a bad description at write time. Run this yourself:
 *
 *   pnpm lint:commits                      # jj: every described commit in trunk()..@
 *   node scripts/check-commit-msg.mjs -r 'trunk()..main'
 *
 * CI is the hard gate and runs on plain git checkouts:
 *
 *   node scripts/check-commit-msg.mjs --range <base>..<head>
 *   node scripts/check-commit-msg.mjs --file .git/COMMIT_EDITMSG   # git hook
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** type → what it means here, and whether it reaches the changelog. */
export const TYPES = {
  feat: "a user-visible capability",
  fix: "a user-visible bug fix",
  perf: "faster or lighter, same behaviour",
  refactor: "restructuring with no behaviour change",
  docs: "README, PLAN, skill docs, code comments",
  style: "formatting only, no code change",
  test: "tests only",
  build: "build system, bundling, dependencies",
  ci: "GitHub Actions, release plumbing",
  chore: "housekeeping that fits nowhere else",
  revert: "undoes a previous commit",
};

const MAX_HEADER = 72;

/** Described, non-root commits on the current stack that aren't upstream yet. */
const DEFAULT_REVSET = 'trunk()..@ & ~description(exact:"")';

/** `type(scope)!: subject` — scope and `!` optional. */
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()\s]+)\))?(?<bang>!)?: (?<subject>.+)$/;

/** Descriptions git or jj generate themselves, or that only exist mid-rebase. */
const EXEMPT = [/^Merge /, /^Revert "/, /^fixup! /, /^squash! /, /^amend! /];

/**
 * @param {string} message full commit description (header + optional body)
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validate(message) {
  const errors = [];
  const warnings = [];
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  // Comment lines are stripped after the editor closes, so ignore them here.
  const header = (lines.find((l) => l.trim() && !l.startsWith("#")) ?? "").trim();

  if (!header) return { errors: ["commit description is empty"], warnings };
  if (EXEMPT.some((re) => re.test(header))) return { errors, warnings };

  const m = HEADER.exec(header);
  if (!m?.groups) {
    errors.push(
      `header does not match "type(scope): subject"\n    got: ${header}`,
      `valid types: ${Object.keys(TYPES).join(", ")}`,
    );
    return { errors, warnings };
  }

  const { type, scope, subject } = m.groups;

  if (!(type in TYPES)) {
    errors.push(`unknown type "${type}" — use one of: ${Object.keys(TYPES).join(", ")}`);
  }
  if (scope && !/^[a-z0-9][a-z0-9._/-]*$/.test(scope)) {
    errors.push(`scope "${scope}" should be lowercase (e.g. mermaid, store, ci)`);
  }
  if (header.length > MAX_HEADER) {
    errors.push(`header is ${header.length} chars, max ${MAX_HEADER} — move detail into the body`);
  }
  if (subject.endsWith(".")) {
    errors.push("subject should not end with a period");
  }
  if (/^[A-Z][a-z]/.test(subject)) {
    warnings.push(`subject should start lowercase: "${subject}"`);
  }
  // "adds X" / "added X" read wrong in a changelog list; "add X" reads right.
  const firstWord = subject.split(/\s+/)[0] ?? "";
  if (/^[a-z]+(ed|s)$/.test(firstWord) && !/^(address|process|focus|pass|css|less)$/.test(firstWord)) {
    warnings.push(`use the imperative mood — "${firstWord}" reads better as a command ("add", not "adds"/"added")`);
  }

  // A body must be separated from the header by a blank line, or the whole
  // thing is read as one very long subject.
  if (lines.length > 1 && lines[1].trim() !== "" && !lines[1].startsWith("#")) {
    errors.push("leave a blank line between the header and the body");
  }

  return { errors, warnings };
}

// ---- collecting descriptions ----------------------------------------------

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });

function isJJ() {
  try {
    run("jj", ["root", "--ignore-working-copy"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * `--ignore-working-copy` keeps the linter side-effect-free: without it, `jj
 * log` snapshots the working copy, so merely checking messages would create a
 * new operation in the oplog.
 */
function fromJJ(revset) {
  const out = run("jj", [
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "--revisions",
    revset,
    "--template",
    'commit_id.short(8) ++ " " ++ description.escape_json() ++ "\\n"',
  ]);
  // escape_json() emits a single-line JSON string, so one record per line.
  return out
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => ({
      label: line.slice(0, 8),
      text: JSON.parse(line.slice(9)),
    }));
}

function fromGitRange(range) {
  const out = run("git", ["log", "--no-merges", "--format=%H%x1f%B%x1e", range]);
  return out
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, text] = entry.split("\x1f");
      return { label: sha.slice(0, 8), text: text ?? "" };
    });
}

function collect(argv) {
  const flag = (...names) => {
    const i = argv.findIndex((a) => names.includes(a));
    return i === -1 ? undefined : argv[i + 1];
  };

  const file = flag("--file");
  if (file) return [{ label: "description", text: readFileSync(file, "utf8") }];

  const range = flag("--range");
  if (range) return fromGitRange(range);

  const revset = flag("--revset", "-r");
  if (revset) return fromJJ(revset);

  return isJJ() ? fromJJ(DEFAULT_REVSET) : fromGitRange("HEAD~1..HEAD");
}

// ---- entry ----------------------------------------------------------------

let commits;
try {
  commits = collect(process.argv.slice(2));
} catch (err) {
  console.error(`check-commit-msg: ${err.message}`);
  process.exit(2);
}

if (commits.length === 0) {
  console.log("No described commits to check.");
  process.exit(0);
}

let failed = false;
for (const { label, text } of commits) {
  const { errors, warnings } = validate(text);
  for (const w of warnings) console.warn(`  ⚠ ${label}: ${w}`);
  for (const e of errors) console.error(`  ✗ ${label}: ${e}`);
  if (errors.length) failed = true;
}

if (failed) {
  console.error(`
Commit descriptions must follow Conventional Commits — the release version and
CHANGELOG are generated from them.

  feat(mermaid): comment on individual diagram parts
  fix(store): keep column width within bounds after a reset
  docs: describe the release flow
  feat!: drop the v1 sidecar format          # ! = breaking

Fix one with:  jj describe -r <change-id> -m "type(scope): subject"

Types: ${Object.entries(TYPES)
    .map(([t, d]) => `\n  ${t.padEnd(9)} ${d}`)
    .join("")}
`);
  process.exit(1);
}

console.log(`✓ ${commits.length} commit description${commits.length === 1 ? "" : "s"} OK`);
