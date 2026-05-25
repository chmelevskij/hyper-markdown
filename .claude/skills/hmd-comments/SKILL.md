---
name: hmd-comments
description: >-
  List and act on review comments left on Markdown/MDX docs by hyper-markdown
  (stored in *.hmd-comments.json sidecar files). Use when the user asks to
  address, action, resolve, or summarize document review comments / feedback
  that came from hyper-markdown. Emits a token-efficient reference-only digest
  so you never read raw sidecar JSON.
allowed-tools: Bash, Read, Edit, Grep
---

# Review comments (hyper-markdown sidecars)

hyper-markdown stores review comments in a sidecar next to each document:
`some/doc.md` → `some/doc.md.hmd-comments.json`. The sidecar is verbose (text
anchors, offsets, baseline snapshot). **Do not read it directly** — it wastes
context and you already have the document. Use the digest script instead.

## Workflow

1. **List open comments** (compact, reference-only — file + line range + note):

   ```bash
   node .claude/skills/hmd-comments/digest.mjs list
   ```

   Pass a directory to scope it (defaults to the cwd, recursive). Add `--all` to
   include resolved comments.

2. **Address each comment.** The digest gives you `file` + `Lstart–end` + the
   note. Open that file at those lines with Read, then make the edit with Edit.
   - Edit the **document**, never the sidecar.
   - For `.mdx`, keep edits valid MDX. For `.md`, keep them valid CommonMark.
   - If a line range looks off (the doc changed since the comment), locate the
     passage by meaning — the note describes what to change.

3. **Mark it resolved** once addressed (re-baselines so it won't re-flag):

   ```bash
   node .claude/skills/hmd-comments/digest.mjs resolve <id>
   ```

   `<id>` is the short id from the digest (any unique prefix works).

4. **Summarize** what you changed, grouped by file, and report any comment you
   could not action (and why).

## Notes

- The script needs Node (already available in this repo). It has no
  dependencies.
- The document for a sidecar is derived from the sidecar's filename, so it works
  even if the repo moved since the comments were written.
- Only address comments the user asked for. If there are many, confirm scope
  first (e.g., "12 open across 3 files — address all, or a specific file?").
