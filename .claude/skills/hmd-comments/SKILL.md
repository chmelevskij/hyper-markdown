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

2. **Triage each comment** before acting. A review comment is one of:

   - **actionable** — a request, a TODO, a suggested rewrite ("rename X",
     "this paragraph is unclear", "add an example"). Edit the doc, then reply
     and resolve (step 3a).
   - **question** — a query the user wants answered, not a doc change
     ("why do we do X here?", "is this still relevant?"). Answer in chat *and*
     leave the same answer on the comment in the hmd UI (step 3b). Do **not**
     resolve — the user closes the thread once they've read the reply.
   - **unclear** — intent is ambiguous. Ask the user before doing either.

   When in doubt, prefer asking over guessing. A wrong edit is more annoying
   than a clarifying question.

   **Gate when questions exist.** If triage found *any* question (or unclear)
   comments, do NOT edit anything yet. First:

   - answer every question (in chat *and* via `reply`, step 3b),
   - present the planned edits for the actionable comments as a short list,
   - then stop and wait for the user's go-ahead — their reaction to an answer
     may change what (or whether) you edit.

   Only when the batch is purely actionable do you proceed straight to step 3
   without pausing.

3. **Act on the comment.**

   **3a. Actionable.** Open the doc at the noted line range with Read, make the
   edit with Edit, then mark resolved (re-baselines so it won't re-flag):

   ```bash
   node .claude/skills/hmd-comments/digest.mjs resolve <id>
   ```

   - Edit the **document**, never the sidecar.
   - For `.mdx`, keep edits valid MDX. For `.md`, keep them valid CommonMark.
   - If a line range looks off (the doc changed since the comment), locate the
     passage by meaning — the note describes what to change.

   **3b. Question.** Compose your answer once, then deliver it twice:

   - **In chat:** include the answer in your reply to the user.
   - **In the hmd UI:** append it to the comment so the thread is self-contained
     when the user revisits the doc:

     ```bash
     node .claude/skills/hmd-comments/digest.mjs reply <id> "<answer>"
     ```

   Keep the in-UI reply short (one or two sentences). If the chat answer is
   longer, the UI reply can summarize and point back ("see chat for the long
   version"). Do not resolve — let the user close the thread.

   `<id>` is the short id from the digest (any unique prefix works).

4. **Summarize** what you did, grouped by file. Distinguish:
   - edits made (and resolved)
   - questions answered (replied in UI, left open)
   - anything skipped or blocked (and why)

## Notes

- The script needs Node (already available in this repo). It has no
  dependencies.
- The document for a sidecar is derived from the sidecar's filename, so it works
  even if the repo moved since the comments were written.
- Only address comments the user asked for. If there are many, confirm scope
  first (e.g., "12 open across 3 files — address all, or a specific file?").
- `reply` appends to the comment's `body` with a `↳ Claude:` marker so the
  thread stays readable in the hmd sidebar. Multiple replies stack.
