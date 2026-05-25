import { useState } from "react";
import { useStore } from "../store/useStore";
import { platform } from "../platform";
import { toJSON, toMarkdown } from "../lib/export";
import { parseImport } from "../lib/importComments";
import type { Comment } from "../types";

function CommentCard({ comment }: { comment: Comment }) {
  const selectedId = useStore((s) => s.selectedId);
  const selectComment = useStore((s) => s.selectComment);
  const updateComment = useStore((s) => s.updateComment);
  const deleteComment = useStore((s) => s.deleteComment);
  const [editing, setEditing] = useState(comment.body === "");
  const [draft, setDraft] = useState(comment.body);

  const selected = selectedId === comment.id;
  const lines = comment.anchor.sourceLineStart;
  const lineLabel =
    lines == null
      ? null
      : comment.anchor.sourceLineEnd && comment.anchor.sourceLineEnd !== lines
        ? `L${lines}–${comment.anchor.sourceLineEnd}`
        : `L${lines}`;

  return (
    <div
      className={`comment-card ${selected ? "is-selected" : ""} ${
        comment.status === "resolved" ? "is-resolved" : ""
      }`}
      onClick={() => selectComment(comment.id)}
    >
      <div className="comment-card__head">
        <span className="comment-card__swatch" style={{ background: comment.color }} />
        {lineLabel && <span className="comment-card__lines">{lineLabel}</span>}
        <div className="comment-card__actions">
          <button
            className="icon-btn"
            title={comment.status === "open" ? "Resolve" : "Reopen"}
            onClick={(e) => {
              e.stopPropagation();
              updateComment(comment.id, {
                status: comment.status === "open" ? "resolved" : "open",
              });
            }}
          >
            {comment.status === "open" ? "✓" : "↺"}
          </button>
          <button
            className="icon-btn"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              deleteComment(comment.id);
            }}
          >
            ✕
          </button>
        </div>
      </div>
      <blockquote className="comment-card__quote">{comment.anchor.quote}</blockquote>
      {editing ? (
        <textarea
          className="comment-card__editor"
          autoFocus
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            updateComment(comment.id, { body: draft.trim() });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              updateComment(comment.id, { body: draft.trim() });
              setEditing(false);
            }
          }}
        />
      ) : (
        <p
          className="comment-card__body"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {comment.body || <span className="comment-card__placeholder">Add a note…</span>}
        </p>
      )}
    </div>
  );
}

export default function CommentSidebar({ width }: { width: number }) {
  const doc = useStore((s) => s.doc);
  const comments = useStore((s) => s.comments);
  const showResolved = useStore((s) => s.showResolved);
  const toggleShowResolved = useStore((s) => s.toggleShowResolved);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const importComments = useStore((s) => s.importComments);
  const [toast, setToast] = useState<string | null>(null);

  const visible = comments.filter((c) => showResolved || c.status === "open");
  const openCount = comments.filter((c) => c.status === "open").length;

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const copyMarkdown = async () => {
    await platform.copyToClipboard(toMarkdown(doc?.name ?? "document", comments, { includeResolved: showResolved }));
    flash("Markdown copied for agent");
  };
  const copyJSON = async () => {
    await platform.copyToClipboard(toJSON(doc?.name ?? "document", comments, { includeResolved: showResolved }));
    flash("JSON copied");
  };
  const writeFile = async () => {
    const base = (doc?.name ?? "document").replace(/\.(md|mdx|markdown)$/i, "");
    const target = await platform.writeExport(
      `${base}.comments.md`,
      toMarkdown(doc?.name ?? "document", comments, { includeResolved: showResolved }),
    );
    if (target) flash(`Saved ${target.split(/[\\/]/).pop()}`);
  };
  const importFile = async () => {
    const picked = await platform.importTextFile();
    if (!picked) return;
    try {
      const parsed = parseImport(picked.text, picked.name);
      if (parsed.length === 0) {
        flash("No comments found in file");
        return;
      }
      const n = importComments(parsed);
      flash(`Imported ${n} comment${n === 1 ? "" : "s"}`);
    } catch (e) {
      flash(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <aside className="sidebar" style={{ flexBasis: width, width }}>
      <div className="sidebar__head">
        <h2>Comments</h2>
        <span className="sidebar__count">{openCount} open</span>
        <button
          className="icon-btn sidebar__collapse"
          onClick={toggleSidebar}
          title="Hide comments"
        >
          ⇥
        </button>
      </div>

      <div className="sidebar__export">
        <button className="btn btn--primary" disabled={!comments.length} onClick={copyMarkdown}>
          Copy for agent
        </button>
        <div className="sidebar__export-row">
          <button className="btn btn--ghost" disabled={!comments.length} onClick={writeFile}>
            Save .md
          </button>
          <button className="btn btn--ghost" disabled={!comments.length} onClick={copyJSON}>
            Copy JSON
          </button>
        </div>
        <button className="btn btn--ghost" onClick={importFile}>
          Import comments…
        </button>
        <label className="sidebar__toggle">
          <input type="checkbox" checked={showResolved} onChange={toggleShowResolved} />
          Show resolved
        </label>
      </div>

      <div className="sidebar__list">
        {visible.length === 0 ? (
          <p className="sidebar__empty">
            Select text in the document to attach a comment. Each comment carries the quoted
            source and its line numbers for the agent.
          </p>
        ) : (
          visible.map((c) => <CommentCard key={c.id} comment={c} />)
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </aside>
  );
}
