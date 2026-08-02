#!/usr/bin/env node
/**
 * Point git at the tracked hooks in .githooks/ (run by `pnpm install` via the
 * `prepare` script).
 *
 * This repo is driven by jj, which has no hook mechanism — so this only covers
 * the colocated git path (or a plain git clone). Commit descriptions written
 * through jj are checked by `pnpm lint:commits` and by CI instead.
 *
 * Fails soft: a missing git binary or a non-repo checkout — an install from a
 * tarball, say — shouldn't break the install.
 */
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
} catch {
  /* not a git checkout, or no git — nothing to install */
}
